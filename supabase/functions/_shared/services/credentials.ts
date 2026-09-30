/**
 * `oauth_credentials` access (ADR-05, DATABASE_AND_RLS_PLAN §4.2, SECURITY_AND_PRIVACY_PLAN CTL-3.3).
 * The table has RLS with no client policies: only the service client reads or writes it, always with
 * the verified user id. Ciphertext is produced by `crypto/token-cipher.ts`; plaintext never leaves the
 * function and is never logged.
 *
 * Also the `credential_reencrypt` job (T-3.04 key rotation): rows with `key_version` below the active
 * version are decrypted and re-encrypted in batches of 200 with a compare-and-swap on
 * `(id, key_version)`, so a concurrent refresh is never overwritten.
 */
import { z } from 'zod';
import type { DbClient } from '../db/clients.ts';
import { mapDbError } from '../errors.ts';
import { fromByteaHex, toByteaHex } from '../crypto/encoding.ts';
import {
  type EncryptedToken,
  reencryptToActive,
  type TokenBinding,
  type TokenKeyring,
  type TokenKind,
} from '../crypto/token-cipher.ts';
import { defineJob } from '../jobs/registry.ts';
import type { JobDefinition } from '../jobs/types.ts';

export interface CredentialRecord extends EncryptedToken {
  readonly id: string;
  readonly userId: string;
  readonly connectedAccountId: string | null;
  readonly provider: string;
  readonly kind: TokenKind;
}

export function bindingOf(
  record: Pick<CredentialRecord, 'userId' | 'connectedAccountId' | 'provider' | 'kind'>,
): TokenBinding {
  return {
    account: record.connectedAccountId ?? record.userId,
    provider: record.provider,
    kind: record.kind,
  };
}

export interface CredentialsRepo {
  /** The Apple SIWA refresh token row of a user (`connected_account_id` null). */
  findUserCredential(userId: string, kind: TokenKind): Promise<CredentialRecord | null>;
  /** Insert or replace the user-level credential (one per user and kind). */
  saveUserCredential(
    userId: string,
    provider: string,
    kind: TokenKind,
    token: EncryptedToken,
  ): Promise<void>;
  listStale(activeVersion: number, limit: number): Promise<CredentialRecord[]>;
  /** Compare-and-swap on `(id, key_version)`; `false` when the row changed meanwhile. */
  swap(id: string, fromVersion: number, token: EncryptedToken): Promise<boolean>;
}

interface Row {
  id: string;
  user_id: string;
  connected_account_id: string | null;
  provider: string;
  token_kind: TokenKind;
  key_version: number;
  iv: string;
  ciphertext: string;
  aad_hash: string;
}

const COLUMNS =
  'id,user_id,connected_account_id,provider,token_kind,key_version,iv,ciphertext,aad_hash';

function fromRow(row: Row): CredentialRecord {
  return {
    id: row.id,
    userId: row.user_id,
    connectedAccountId: row.connected_account_id,
    provider: row.provider,
    kind: row.token_kind,
    keyVersion: row.key_version,
    iv: fromByteaHex(row.iv),
    ciphertext: fromByteaHex(row.ciphertext),
    aadHash: fromByteaHex(row.aad_hash),
  };
}

function tokenColumns(token: EncryptedToken): Record<string, unknown> {
  return {
    key_version: token.keyVersion,
    iv: toByteaHex(token.iv),
    ciphertext: toByteaHex(token.ciphertext),
    aad_hash: toByteaHex(token.aadHash),
  };
}

export function supabaseCredentialsRepo(
  system: DbClient,
  now: () => Date = () => new Date(),
): CredentialsRepo {
  const table = () => system.from('oauth_credentials');
  return {
    async findUserCredential(userId, kind) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('user_id', userId)
        .eq('token_kind', kind)
        .is('connected_account_id', null)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return data === null ? null : fromRow(data as Row);
    },
    async saveUserCredential(userId, provider, kind, token) {
      const columns = { ...tokenColumns(token), rotated_at: now().toISOString() };
      const { error } = await table().insert({
        user_id: userId,
        connected_account_id: null,
        provider,
        token_kind: kind,
        ...columns,
      });
      if (error === null) return;
      if (error.code !== '23505') throw mapDbError(error);
      // The partial unique index (user_id, token_kind) where connected_account_id is null already has a row.
      const { error: updateError } = await table()
        .update(columns)
        .eq('user_id', userId)
        .eq('token_kind', kind)
        .is('connected_account_id', null);
      if (updateError !== null) throw mapDbError(updateError);
    },
    async listStale(activeVersion, limit) {
      const { data, error } = await table()
        .select(COLUMNS)
        .lt('key_version', activeVersion)
        .order('id')
        .limit(limit);
      if (error !== null) throw mapDbError(error);
      return ((data ?? []) as Row[]).map(fromRow);
    },
    async swap(id, fromVersion, token) {
      const { data, error } = await table()
        .update({ ...tokenColumns(token), rotated_at: now().toISOString() })
        .eq('id', id)
        .eq('key_version', fromVersion)
        .select('id');
      if (error !== null) throw mapDbError(error);
      return Array.isArray(data) && data.length === 1;
    },
  };
}

/** Re-encrypts up to `batch` stale rows; returns counts (never plaintext). */
export async function reencryptBatch(
  repo: CredentialsRepo,
  keyring: TokenKeyring,
  batch = 200,
): Promise<{ scanned: number; reencrypted: number; conflicts: number; failed: number }> {
  const rows = await repo.listStale(keyring.activeVersion, batch);
  let reencrypted = 0;
  let conflicts = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const next = await reencryptToActive(keyring, row, bindingOf(row));
      if (next === null) continue;
      if (await repo.swap(row.id, row.keyVersion, next)) reencrypted++;
      else conflicts++;
    } catch {
      failed++;
    }
  }
  return { scanned: rows.length, reencrypted, conflicts, failed };
}

/** `credential_reencrypt` (enqueued daily by `da_reconciliation`, DB §9): one batch per run. */
export function credentialReencryptJob(deps: {
  readonly repo: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
}): JobDefinition<Record<string, never>> {
  return defineJob({
    type: 'credential_reencrypt',
    payload: z.strictObject({}),
    async handler(ctx) {
      const keyring = await deps.keyring();
      const result = await reencryptBatch(deps.repo, keyring);
      ctx.log.info('credential_reencrypt_batch', {
        ...result,
        active_version: keyring.activeVersion,
      });
      if (result.scanned === 200 && result.reencrypted > 0) {
        await ctx.enqueue({
          type: 'credential_reencrypt',
          idempotencyKey: `credential_reencrypt:${ctx.now().toISOString().slice(0, 10)}:${ctx.job.id}`,
        });
      }
      return { ...result, active_version: keyring.activeVersion };
    },
  });
}
