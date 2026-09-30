/**
 * Provider sessions for approval writes: the adapters come from the provider registry
 * (`_shared/providers/registry.ts`; credentials and demo mode checked there) and the context carries
 * a token source over `oauth_credentials` (INTEGRATION_PLAN §3.4): the stored access token while it
 * is valid for at least 60 s, otherwise one refresh under `try_lock_credential_refresh` with the
 * rotated tokens re-encrypted (AES-GCM, account-bound AAD). Plaintext never leaves the function.
 */
import type {
  AccessTokenSource,
  ContentFreeLogger,
  ProviderAccountRef,
  ServerProvider,
  ServerProviderAdapters,
} from '@da/domain';
import { ProviderError } from '@da/domain';
import { fromByteaHex, toByteaHex } from '../../../crypto/encoding.ts';
import { decryptToken, encryptToken, type TokenKeyring } from '../../../crypto/token-cipher.ts';
import type { DbClient } from '../../../db/clients.ts';
import { DB_FN, rpc } from '../../../db/functions.ts';
import { AppError, mapDbError } from '../../../errors.ts';
import type { Logger } from '../../../logging/logger.ts';
import type { ProviderRegistry } from '../../../providers/registry.ts';
import { supabaseQuotaGate } from '../../../providers/http.ts';
import type { ProviderSessions } from './model.ts';

const SERVER_PROVIDERS = new Set<string>(['google', 'microsoft', 'demo']);
export const TOKEN_MIN_VALIDITY_MS = 60_000;

interface CredentialRow {
  id: string;
  token_kind: 'access' | 'refresh';
  key_version: number;
  iv: string;
  ciphertext: string;
  aad_hash: string;
  access_expires_at: string | null;
}

function contentFree(log: Logger): ContentFreeLogger {
  return {
    info: (event, fields) => log.info(event, fields ?? {}),
    warn: (event, fields) => log.warn(event, fields ?? {}),
    error: (event, fields) => log.error(event, fields ?? {}),
  };
}

export function credentialTokenSource(input: {
  readonly system: DbClient;
  readonly keyring: () => Promise<TokenKeyring>;
  readonly account: ProviderAccountRef;
  readonly adapters: ServerProviderAdapters;
  readonly owner: string;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}): AccessTokenSource {
  const { system, account } = input;
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const binding = (kind: 'access' | 'refresh') => ({
    account: account.connectedAccountId,
    provider: account.provider,
    kind,
  });

  async function rows(): Promise<Map<string, CredentialRow>> {
    const { data, error } = await system
      .from('oauth_credentials')
      .select('id,token_kind,key_version,iv,ciphertext,aad_hash,access_expires_at')
      .eq('connected_account_id', account.connectedAccountId)
      .in('token_kind', ['access', 'refresh']);
    if (error !== null) throw mapDbError(error);
    return new Map(((data ?? []) as CredentialRow[]).map((r) => [r.token_kind, r]));
  }

  async function decrypt(row: CredentialRow): Promise<string> {
    return decryptToken(
      await input.keyring(),
      {
        keyVersion: row.key_version,
        iv: fromByteaHex(row.iv),
        ciphertext: fromByteaHex(row.ciphertext),
        aadHash: fromByteaHex(row.aad_hash),
      },
      binding(row.token_kind),
    );
  }

  const fresh = (row: CredentialRow | undefined): row is CredentialRow =>
    row !== undefined &&
    row.access_expires_at !== null &&
    Date.parse(row.access_expires_at) - now().getTime() > TOKEN_MIN_VALIDITY_MS;

  async function store(kind: 'access' | 'refresh', token: string, extra: Record<string, unknown>) {
    const encrypted = await encryptToken(await input.keyring(), token, binding(kind));
    const columns = {
      key_version: encrypted.keyVersion,
      iv: toByteaHex(encrypted.iv),
      ciphertext: toByteaHex(encrypted.ciphertext),
      aad_hash: toByteaHex(encrypted.aadHash),
      rotated_at: now().toISOString(),
      refresh_lock_until: null,
      refresh_lock_owner: null,
      ...extra,
    };
    // The unique index on (connected_account_id, token_kind) is partial, so update first.
    const { data, error } = await system
      .from('oauth_credentials')
      .update(columns)
      .eq('connected_account_id', account.connectedAccountId)
      .eq('token_kind', kind)
      .select('id');
    if (error !== null) throw mapDbError(error);
    if (Array.isArray(data) && data.length > 0) return;
    const inserted = await system.from('oauth_credentials').insert({
      user_id: account.userId,
      connected_account_id: account.connectedAccountId,
      provider: account.provider,
      token_kind: kind,
      ...columns,
    });
    if (inserted.error !== null) throw mapDbError(inserted.error);
  }

  return {
    async get(opts = {}) {
      if (account.provider === 'demo') return 'demo';
      let current = await rows();
      const access = current.get('access');
      if (opts.forceRefresh !== true && fresh(access)) return decrypt(access);
      for (let attempt = 0; attempt < 3; attempt++) {
        const locked = await rpc<boolean>(system, DB_FN.tryLockCredentialRefresh, {
          p_account: account.connectedAccountId,
          p_owner: input.owner,
          p_seconds: 30,
        });
        if (locked) break;
        await sleep(500);
        current = await rows();
        const other = current.get('access');
        if (opts.forceRefresh !== true && fresh(other)) return decrypt(other);
        if (attempt === 2) throw new ProviderError('rate_limited', null, 2_000, 'refresh_locked');
      }
      const refresh = current.get('refresh');
      if (refresh === undefined)
        throw new ProviderError('auth_invalid_grant', null, null, 'no_refresh_token');
      const tokens = await input.adapters.oauth.refresh({
        refreshToken: await decrypt(refresh),
        tenantId: account.tenantId,
      });
      await store('access', tokens.accessToken, {
        access_expires_at: tokens.accessTokenExpiresAt,
        scope_snapshot: tokens.grantedScope,
      });
      if (tokens.refreshToken !== null) await store('refresh', tokens.refreshToken, {});
      return tokens.accessToken;
    },
  };
}

/** Production sessions: registry adapters + credential token source + provider quota gate. */
export function registryProviderSessions(input: {
  readonly system: DbClient;
  readonly registry: ProviderRegistry;
  readonly keyring: () => Promise<TokenKeyring>;
  readonly now?: () => Date;
}): ProviderSessions {
  return {
    open(account, opts) {
      if (!SERVER_PROVIDERS.has(account.provider)) {
        return Promise.reject(
          new AppError('FEATURE_DISABLED', { details: { reason: 'device_provider' } }),
        );
      }
      const provider = account.provider as ServerProvider;
      const adapters = input.registry.resolve(provider);
      const now = input.now ?? (() => new Date());
      return Promise.resolve({
        provider,
        adapters,
        ctx: {
          account,
          tokens: credentialTokenSource({
            system: input.system,
            keyring: input.keyring,
            account,
            adapters,
            owner: `approval:${opts.correlationId}`.slice(0, 64),
            now,
          }),
          quota: supabaseQuotaGate(input.system, account.connectedAccountId),
          clock: { now },
          log: contentFree(opts.log),
          correlationId: opts.correlationId,
          signal: opts.signal,
        },
      });
    },
  };
}
