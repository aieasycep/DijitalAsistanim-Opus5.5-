/**
 * Database access of the privacy routes and jobs (T-11.01…T-11.04). Every call takes the user id
 * from verified claims or from the request row, never from a request body. The SQL lives in
 * migrations 20260924002500 / 002510 (service-role wrappers) and 20260924002220
 * (`create_deletion_request`).
 */
import type { DeletionKind, DeletionStatus, ExportStatus } from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { mapDbError } from '../../errors.ts';
import { fromByteaHex, toByteaHex, toHex } from '../../crypto/encoding.ts';
import { enqueueJob } from '../../jobs/client.ts';
import type { EnqueueInput, Json } from '../../jobs/types.ts';
import type { PrivateBucket } from './storage.ts';

export type Steps = Record<string, Json>;

export interface ExportRequestRow {
  readonly id: string;
  readonly user_id: string;
  readonly status: ExportStatus;
  readonly include: string[] | null;
  readonly storage_path: string | null;
  readonly file_size_bytes: number | null;
  /** Hex digest of the archive. */
  readonly sha256: string | null;
  readonly ready_at: string | null;
  readonly expires_at: string | null;
}

export interface ExportPatch {
  readonly status?: ExportStatus;
  readonly storage_path?: string | null;
  readonly file_size_bytes?: number | null;
  readonly sha256?: string | null;
  readonly ready_at?: string | null;
  readonly expires_at?: string | null;
  readonly downloaded_at?: string;
  readonly error_code?: string | null;
  readonly job_id?: string;
}

export interface DeletionRequestRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly kind: DeletionKind;
  readonly status: DeletionStatus;
  readonly origin: 'app' | 'web_otp' | 'admin';
  readonly scope: 'all_analysis' | 'connected_account' | null;
  readonly connected_account_id: string | null;
  readonly steps: Steps;
  /** version ‖ iv ‖ ciphertext of the confirmation address, or null. */
  readonly notify_email_ciphertext: Uint8Array | null;
  readonly notify_locale: 'tr' | 'en' | null;
  readonly created_at: string;
}

export interface DeletionUpdate {
  readonly status?: DeletionStatus;
  readonly steps?: Steps;
  readonly errorCode?: string;
  readonly notify?: Uint8Array;
  readonly notifyLocale?: 'tr' | 'en';
  readonly clearNotify?: boolean;
}

export interface HistoryCounts {
  readonly summaries: number;
  readonly priority_decisions: number;
  readonly memory_chunks: number;
  readonly assistant_threads: number;
  readonly learned_preferences: number;
  readonly insights: number;
  readonly briefings: number;
}

/** `{deleted:{table:n}, storage_paths:{bucket:[…]}}` of the purge and retention functions. */
export interface PurgeResult {
  readonly deleted: Record<string, number>;
  readonly storage_paths: Partial<Record<PrivateBucket, string[]>>;
}

export interface AccountDeletionContext {
  readonly user_exists: boolean;
  readonly email: string | null;
  readonly locale: string | null;
  readonly installation_ids: string[];
  readonly apple_sub: string | null;
  readonly accounts: { id: string; provider: string; status: string }[];
}

/** One export source: a table read with an explicit column allow-list, filtered by the owner. */
export interface ExportSource {
  readonly table: string;
  readonly columns: string;
  /** Owner column (`user_id`), or `referrals` (either side) / `audit` (target user). */
  readonly owner: 'user_id' | 'referrals' | 'audit';
  readonly order: string;
}

export interface PrivacyRepo {
  // ── Export (API-PRV-01/04, JOB-21) ──
  createExportRequest(
    userId: string,
    include: readonly string[] | null,
    correlationId: string | null,
  ): Promise<{ created: boolean; request_id: string; status: ExportStatus }>;
  getExport(id: string): Promise<ExportRequestRow | null>;
  updateExport(id: string, userId: string, patch: ExportPatch): Promise<void>;
  readRows(source: ExportSource, userId: string, offset: number, limit: number): Promise<unknown[]>;
  userLocale(userId: string): Promise<{ locale: string | null; timezone: string | null }>;
  // ── Deletion (API-PRV-02/03, JOB-22/23) ──
  historyCounts(userId: string, accountId: string | null): Promise<HistoryCounts>;
  createDeletionRequest(input: {
    userId: string;
    kind: DeletionKind;
    statusTokenHash: Uint8Array | null;
    scope: 'all_analysis' | 'connected_account' | null;
    accountId: string | null;
    correlationId: string | null;
  }): Promise<{ request_id: string; status: DeletionStatus; created: boolean }>;
  getDeletionRequest(id: string): Promise<DeletionRequestRow | null>;
  updateDeletionRequest(
    id: string,
    update: DeletionUpdate,
  ): Promise<{ status: DeletionStatus; steps: Steps }>;
  purgeHistory(userId: string, accountId: string | null): Promise<PurgeResult>;
  accountContext(userId: string): Promise<AccountDeletionContext>;
  beginAccountDeletion(
    requestId: string,
    userId: string,
    jobId: string | null,
  ): Promise<{ state: DeletionStatus; steps: Steps }>;
  systemPurge(userId: string, jobId: string | null): Promise<Record<string, number>>;
  upsertTombstones(signals: readonly { kind: string; hash: string }[]): Promise<number>;
  rowsRemaining(userId: string): Promise<Record<string, number>>;
  pseudonymizeAudit(userId: string): Promise<void>;
  // ── Retention (JOB-20) ──
  retentionCleanup(batch: number, now: Date): Promise<PurgeResult>;
  recomputeExpiresAt(userId: string, batch: number): Promise<number>;
  orphanObjects(now: Date, limit: number): Promise<Partial<Record<PrivateBucket, string[]>>>;
  systemSweep(batch: number, now: Date): Promise<Record<string, number>>;
  // ── Queue ──
  enqueue(job: EnqueueInput): Promise<string>;
}

const EXPORT_COLUMNS =
  'id,user_id,status,include,storage_path,file_size_bytes,sha256,ready_at,expires_at';
const DELETION_COLUMNS =
  'id,user_id,kind,status,origin,scope,connected_account_id,steps,notify_email_ciphertext,notify_locale,created_at';

interface RawExportRow extends Omit<ExportRequestRow, 'sha256'> {
  readonly sha256: string | null;
}
interface RawDeletionRow extends Omit<DeletionRequestRow, 'notify_email_ciphertext'> {
  readonly notify_email_ciphertext: string | null;
}

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
    if (typeof n === 'number') out[key] = n;
  }
  return out;
}

function purgeResult(value: unknown): PurgeResult {
  const raw = (value ?? {}) as { deleted?: unknown; storage_paths?: Record<string, unknown> };
  const paths: Partial<Record<PrivateBucket, string[]>> = {};
  for (const [bucket, list] of Object.entries(raw.storage_paths ?? {})) {
    if (Array.isArray(list)) {
      paths[bucket as PrivateBucket] = list.filter((p): p is string => typeof p === 'string');
    }
  }
  return { deleted: numbers(raw.deleted), storage_paths: paths };
}

export function supabasePrivacyRepo(system: DbClient): PrivacyRepo {
  return {
    async createExportRequest(userId, include, correlationId) {
      return await rpc(system, DB_FN.createExportRequest, {
        p_user: userId,
        p_include: include,
        p_correlation_id: correlationId,
      });
    },
    async getExport(id) {
      const { data, error } = await system
        .from('data_export_requests')
        .select(EXPORT_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      if (data === null) return null;
      const row = data as unknown as RawExportRow;
      return { ...row, sha256: row.sha256 === null ? null : toHex(fromByteaHex(row.sha256)) };
    },
    async updateExport(id, userId, patch) {
      const { sha256, ...rest } = patch;
      const values: Record<string, unknown> = { ...rest };
      if (sha256 !== undefined) {
        values.sha256 = sha256 === null ? null : `\\x${sha256}`;
      }
      const { error } = await system
        .from('data_export_requests')
        .update(values)
        .eq('id', id)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async readRows(source, userId, offset, limit) {
      let query = system.from(source.table).select(source.columns);
      if (source.owner === 'user_id') query = query.eq('user_id', userId);
      else if (source.owner === 'audit') query = query.eq('target_user_id', userId);
      else query = query.or(`referrer_id.eq.${userId},referee_id.eq.${userId}`);
      for (const column of source.order.split(','))
        query = query.order(column, { ascending: true });
      const { data, error } = await query.range(offset, offset + limit - 1);
      if (error !== null) throw mapDbError(error);
      return (data ?? []) as unknown[];
    },
    async userLocale(userId) {
      const [profile, prefs] = await Promise.all([
        system.from('profiles').select('locale').eq('user_id', userId).maybeSingle(),
        system.from('user_preferences').select('timezone').eq('user_id', userId).maybeSingle(),
      ]);
      if (profile.error !== null) throw mapDbError(profile.error);
      if (prefs.error !== null) throw mapDbError(prefs.error);
      return {
        locale: (profile.data as { locale?: string } | null)?.locale ?? null,
        timezone: (prefs.data as { timezone?: string } | null)?.timezone ?? null,
      };
    },
    async historyCounts(userId, accountId) {
      return await rpc<HistoryCounts>(system, DB_FN.historyDeletionCounts, {
        p_user: userId,
        p_account: accountId,
      });
    },
    async createDeletionRequest(input) {
      return await rpc(system, DB_FN.createDeletionRequest, {
        p_user: input.userId,
        p_kind: input.kind,
        p_origin: 'app',
        p_confirmation: 'reauth',
        p_status_token_hash:
          input.statusTokenHash === null ? null : toByteaHex(input.statusTokenHash),
        p_subject_email_hash: null,
        p_scope: input.scope,
        p_account: input.accountId,
        p_source: 'app',
        p_correlation_id: input.correlationId,
      });
    },
    async getDeletionRequest(id) {
      const { data, error } = await system
        .from('data_deletion_requests')
        .select(DELETION_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      if (data === null) return null;
      const row = data as unknown as RawDeletionRow;
      return {
        ...row,
        notify_email_ciphertext:
          row.notify_email_ciphertext === null ? null : fromByteaHex(row.notify_email_ciphertext),
      };
    },
    async updateDeletionRequest(id, update) {
      return await rpc(system, DB_FN.deletionRequestUpdate, {
        p_request: id,
        p_status: update.status ?? null,
        p_steps: update.steps ?? {},
        p_error_code: update.errorCode ?? null,
        p_notify: update.notify === undefined ? null : toByteaHex(update.notify),
        p_notify_locale: update.notifyLocale ?? null,
        p_clear_notify: update.clearNotify === true,
      });
    },
    async purgeHistory(userId, accountId) {
      return purgeResult(
        await rpc(system, DB_FN.purgeHistory, { p_user: userId, p_account: accountId }),
      );
    },
    async accountContext(userId) {
      return await rpc(system, DB_FN.accountDeletionContext, { p_user: userId });
    },
    async beginAccountDeletion(requestId, userId, jobId) {
      return await rpc(system, DB_FN.accountDeletionBegin, {
        p_request: requestId,
        p_user: userId,
        p_job: jobId,
      });
    },
    async systemPurge(userId, jobId) {
      return numbers(
        await rpc(system, DB_FN.accountDeletionSystemPurge, { p_user: userId, p_job: jobId }),
      );
    },
    async upsertTombstones(signals) {
      return await rpc<number>(system, DB_FN.privacyTombstonesUpsert, { p_signals: signals });
    },
    async rowsRemaining(userId) {
      return numbers(await rpc(system, DB_FN.userRowsRemaining, { p_user: userId }));
    },
    async pseudonymizeAudit(userId) {
      await rpc(system, DB_FN.pseudonymizeAuditSubject, { p_user: userId });
    },
    async retentionCleanup(batch, now) {
      return purgeResult(
        await rpc(system, DB_FN.retentionCleanup, { p_batch: batch, p_now: now.toISOString() }),
      );
    },
    async recomputeExpiresAt(userId, batch) {
      return await rpc<number>(system, DB_FN.recomputeExpiresAt, {
        p_user: userId,
        p_batch: batch,
      });
    },
    async orphanObjects(now, limit) {
      return purgeResult({
        storage_paths: await rpc(system, DB_FN.retentionOrphanObjects, {
          p_now: now.toISOString(),
          p_limit: limit,
        }),
      }).storage_paths;
    },
    async systemSweep(batch, now) {
      return numbers(
        await rpc(system, DB_FN.retentionSystemSweep, { p_batch: batch, p_now: now.toISOString() }),
      );
    },
    enqueue: (job) => enqueueJob(system, job),
  };
}
