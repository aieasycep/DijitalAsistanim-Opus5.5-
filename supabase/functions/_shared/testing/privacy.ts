/**
 * In-memory fakes of the privacy repository and the Storage API with the semantics of their SQL
 * counterparts (migrations 20260924002500 / 002510, 20260924002220 `create_deletion_request`):
 * one export in flight per user, one active deletion request per user and kind, the honest status
 * edges of `deletion_request_update`, owner filters on every export read.
 */
import type { DeletionStatus } from '@da/domain';
import type { EnqueueInput, Json } from '../jobs/types.ts';
import type {
  AccountDeletionContext,
  DeletionRequestRow,
  ExportRequestRow,
  HistoryCounts,
  PrivacyRepo,
  PurgeResult,
  Steps,
} from '../services/privacy/repo.ts';
import type { ObjectStore, PrivateBucket } from '../services/privacy/storage.ts';

export interface MemoryObjectStore extends ObjectStore {
  readonly objects: Map<string, Blob>;
  readonly removed: string[];
  put(bucket: PrivateBucket, path: string, body?: string): void;
  get(bucket: PrivateBucket, path: string): Blob | undefined;
  failRemove: boolean;
}

export function memoryObjectStore(): MemoryObjectStore {
  const objects = new Map<string, Blob>();
  const removed: string[] = [];
  const key = (bucket: string, path: string) => `${bucket}:${path}`;
  const store: MemoryObjectStore = {
    objects,
    removed,
    failRemove: false,
    put(bucket, path, body = 'x') {
      objects.set(key(bucket, path), new Blob([body]));
    },
    get: (bucket, path) => objects.get(key(bucket, path)),
    upload(bucket, path, body) {
      objects.set(key(bucket, path), body);
      return Promise.resolve();
    },
    remove(bucket, paths) {
      if (store.failRemove) return Promise.reject(new Error('storage down'));
      let n = 0;
      for (const path of paths) {
        if (objects.delete(key(bucket, path))) {
          removed.push(key(bucket, path));
          n++;
        }
      }
      return Promise.resolve(n);
    },
    list(bucket, prefix) {
      const head = `${bucket}:${prefix.replace(/\/+$/, '')}/`;
      return Promise.resolve(
        [...objects.keys()]
          .filter((k) => k.startsWith(head))
          .map((k) => k.slice(bucket.length + 1)),
      );
    },
    signedUrl(bucket, path, ttl) {
      return Promise.resolve(`https://storage.test/${bucket}/${path}?token=signed&ttl=${ttl}`);
    },
  };
  return store;
}

const ACTIVE: readonly DeletionStatus[] = ['requested', 'verified', 'queued', 'processing'];

type ExportState = ExportRequestRow & { downloaded_at: string | null; error_code: string | null };

export interface MemoryPrivacyRepo extends PrivacyRepo {
  readonly exports: Map<string, ExportState>;
  readonly deletions: Map<string, DeletionRequestRow & { status_token_hash: Uint8Array | null }>;
  /** Rows by table for export reads. */
  tables: Record<string, Record<string, unknown>[]>;
  readonly enqueued: EnqueueInput[];
  readonly calls: string[];
  counts: HistoryCounts;
  purge: PurgeResult;
  context: AccountDeletionContext;
  remaining: Record<string, number>;
  cleanups: PurgeResult[];
  recomputes: number[];
  orphans: Partial<Record<PrivateBucket, string[]>>;
  tombstones: { kind: string; hash: string }[];
  locale: { locale: string | null; timezone: string | null };
}

export function memoryPrivacyRepo(): MemoryPrivacyRepo {
  const exports = new Map<string, ExportState>();
  const deletions: MemoryPrivacyRepo['deletions'] = new Map();
  const calls: string[] = [];
  const enqueued: EnqueueInput[] = [];
  const repo: MemoryPrivacyRepo = {
    exports,
    deletions,
    tables: {},
    enqueued,
    calls,
    counts: {
      summaries: 0,
      priority_decisions: 0,
      memory_chunks: 0,
      assistant_threads: 0,
      learned_preferences: 0,
      insights: 0,
      briefings: 0,
    },
    purge: { deleted: {}, storage_paths: {} },
    context: {
      user_exists: true,
      email: null,
      locale: 'tr-TR',
      installation_ids: [],
      apple_sub: null,
      accounts: [],
    },
    remaining: {},
    cleanups: [],
    recomputes: [],
    orphans: {},
    tombstones: [],
    locale: { locale: 'tr-TR', timezone: 'Europe/Istanbul' },

    createExportRequest(userId, include) {
      calls.push('createExportRequest');
      const active = [...exports.values()].find(
        (e) => e.user_id === userId && (e.status === 'requested' || e.status === 'processing'),
      );
      if (active !== undefined) {
        return Promise.resolve({ created: false, request_id: active.id, status: active.status });
      }
      const id = crypto.randomUUID();
      exports.set(id, {
        id,
        user_id: userId,
        status: 'requested',
        include: include === null ? null : [...include],
        storage_path: null,
        file_size_bytes: null,
        sha256: null,
        ready_at: null,
        expires_at: null,
        downloaded_at: null,
        error_code: null,
      });
      enqueued.push({
        type: 'export',
        idempotencyKey: `export:${id}`,
        payload: { data_export_request_id: id, user_id: userId },
        userId,
      });
      return Promise.resolve({ created: true, request_id: id, status: 'requested' });
    },
    getExport: (id) => Promise.resolve(exports.get(id) ?? null),
    updateExport(id, userId, patch) {
      const row = exports.get(id);
      if (row !== undefined && row.user_id === userId) exports.set(id, { ...row, ...patch });
      return Promise.resolve();
    },
    readRows(source, userId, offset, limit) {
      const rows = (repo.tables[source.table] ?? []).filter((r) =>
        source.owner === 'user_id'
          ? r.user_id === userId
          : source.owner === 'audit'
            ? r.target_user_id === userId
            : r.referrer_id === userId || r.referee_id === userId,
      );
      const columns = source.columns.split(',');
      return Promise.resolve(
        rows
          .slice(offset, offset + limit)
          .map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]]))),
      );
    },
    userLocale: () => Promise.resolve(repo.locale),

    historyCounts(_userId, _accountId) {
      calls.push('historyCounts');
      return Promise.resolve(repo.counts);
    },
    createDeletionRequest(input) {
      calls.push(`createDeletionRequest:${input.kind}`);
      const active = [...deletions.values()].find(
        (d) => d.user_id === input.userId && d.kind === input.kind && ACTIVE.includes(d.status),
      );
      if (active !== undefined) {
        if (input.statusTokenHash !== null) active.status_token_hash = input.statusTokenHash;
        return Promise.resolve({ request_id: active.id, status: active.status, created: false });
      }
      const id = crypto.randomUUID();
      deletions.set(id, {
        id,
        user_id: input.userId,
        kind: input.kind,
        status: 'queued',
        origin: 'app',
        scope: input.kind === 'history' ? (input.scope ?? 'all_analysis') : null,
        connected_account_id: input.kind === 'history' ? input.accountId : null,
        steps: {},
        notify_email_ciphertext: null,
        notify_locale: null,
        created_at: new Date().toISOString(),
        status_token_hash: input.statusTokenHash,
      });
      enqueued.push({
        type: input.kind === 'account' ? 'account_deletion' : 'history_deletion',
        idempotencyKey: `${input.kind === 'account' ? 'account_deletion' : 'history_deletion'}:${id}`,
        payload: { data_deletion_request_id: id, user_id: input.userId },
        userId: input.kind === 'account' ? null : input.userId,
      });
      return Promise.resolve({ request_id: id, status: 'queued', created: true });
    },
    getDeletionRequest: (id) => Promise.resolve(deletions.get(id) ?? null),
    updateDeletionRequest(id, update) {
      const row = deletions.get(id);
      if (row === undefined) return Promise.reject(new Error('NOT_FOUND'));
      const to = update.status;
      if (to !== undefined && to !== row.status) {
        const legal =
          (['requested', 'verified', 'queued', 'failed'].includes(row.status) &&
            to === 'processing') ||
          (row.status === 'processing' && (to === 'completed' || to === 'failed'));
        if (!legal) return Promise.reject(new Error(`ILLEGAL_TRANSITION:${row.status}->${to}`));
      }
      const steps: Steps = { ...row.steps, ...(update.steps ?? {}) };
      deletions.set(id, {
        ...row,
        status: to ?? row.status,
        steps,
        notify_email_ciphertext: update.clearNotify
          ? null
          : (update.notify ?? row.notify_email_ciphertext),
        notify_locale: update.clearNotify ? null : (update.notifyLocale ?? row.notify_locale),
      });
      return Promise.resolve({ status: to ?? row.status, steps });
    },
    purgeHistory(userId, accountId) {
      calls.push(`purgeHistory:${userId}:${accountId ?? 'all'}`);
      return Promise.resolve(repo.purge);
    },
    accountContext(_userId) {
      calls.push('accountContext');
      return Promise.resolve(repo.context);
    },
    beginAccountDeletion(requestId, _userId, _jobId) {
      calls.push('begin');
      const row = deletions.get(requestId);
      if (row === undefined) return Promise.reject(new Error('NOT_FOUND'));
      if (row.status === 'completed' || row.status === 'cancelled') {
        return Promise.resolve({ state: row.status, steps: row.steps });
      }
      deletions.set(requestId, { ...row, status: 'processing' });
      return Promise.resolve({ state: 'processing', steps: row.steps });
    },
    systemPurge(_userId, _jobId) {
      calls.push('systemPurge');
      return Promise.resolve({ analytics_events: 1 });
    },
    upsertTombstones(signals) {
      calls.push('tombstones');
      repo.tombstones.push(...signals);
      return Promise.resolve(signals.length);
    },
    rowsRemaining(_userId) {
      calls.push('rowsRemaining');
      return Promise.resolve(repo.remaining);
    },
    pseudonymizeAudit(_userId) {
      calls.push('pseudonymizeAudit');
      return Promise.resolve();
    },
    retentionCleanup(_batch, _now) {
      calls.push('retentionCleanup');
      return Promise.resolve(
        repo.cleanups.shift() ?? { deleted: { insights: 0 }, storage_paths: {} },
      );
    },
    recomputeExpiresAt(_userId, _batch) {
      calls.push('recompute');
      return Promise.resolve(repo.recomputes.shift() ?? 0);
    },
    orphanObjects(_now, _limit) {
      calls.push('orphans');
      const out = repo.orphans;
      repo.orphans = {};
      return Promise.resolve(out);
    },
    systemSweep(_batch, _now) {
      calls.push('systemSweep');
      return Promise.resolve({ job_attempts: 2 });
    },
    enqueue(job) {
      enqueued.push(job);
      return Promise.resolve(crypto.randomUUID());
    },
  };
  return repo;
}

/** Steps as plain JSON (for assertions). */
export function stepsOf(repo: MemoryPrivacyRepo, id: string): Record<string, Json> {
  return { ...(repo.deletions.get(id)?.steps ?? {}) };
}
