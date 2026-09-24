/**
 * JOB-22 `history_deletion` (API_CONTRACTS §11.4; SECURITY_AND_PRIVACY_PLAN §4.7; IMPLEMENTATION_PLAN
 * T-11.02; R-16). Deletes the analysis history of the user (`all_analysis`) or of one connected
 * account (`connected_account`) with `private.purge_history`, then removes the returned capture,
 * reply-attachment and briefing-audio objects through the Storage API. Connections, settings, VIP,
 * rules, open commitments and scheduled reminders are kept.
 *
 * Every step is recorded in `data_deletion_requests.steps` (`db_purged`, `storage_purged`, counts)
 * and the status only moves `queued → processing → completed | failed`. The object paths are
 * checkpointed in `jobs.progress` before removal, so a retried attempt removes them without purging
 * again; objects of an attempt that died before the checkpoint are removed by the retention sweep
 * (`retention_orphan_objects`, rows gone for 24 h).
 */
import { toDeepLink } from '@da/domain';
import { isAppError } from '../../errors.ts';
import { type Json, JobError, type JobContext, type JobResult } from '../../jobs/types.ts';
import type { AuditWriter } from '../audit.ts';
import { notificationBuildJob } from '../notifications/create.ts';
import type { DeletionRequestRow, PrivacyRepo, PurgeResult } from './repo.ts';
import {
  type ObjectStore,
  type PrivateBucket,
  PRIVATE_BUCKETS,
  removeInBatches,
} from './storage.ts';

export interface DeletionJobDeps {
  readonly repo: PrivacyRepo;
  readonly store: ObjectStore;
  readonly audit: AuditWriter;
}

export interface DeletionJobPayload {
  readonly data_deletion_request_id?: string | undefined;
  /** Admin retry (`admin_api.data_request_retry`) enqueues `{request_id}` only. */
  readonly request_id?: string | undefined;
  readonly user_id?: string | undefined;
}

/** The request of a deletion job; the user id always comes from the request row. */
export async function loadDeletionRequest(
  repo: PrivacyRepo,
  payload: DeletionJobPayload,
  kind: DeletionRequestRow['kind'],
): Promise<DeletionRequestRow | null> {
  const id = payload.data_deletion_request_id ?? payload.request_id;
  if (id === undefined) throw new JobError('POISON_PAYLOAD', false);
  const row = await repo.getDeletionRequest(id);
  if (row === null) return null;
  if (row.kind !== kind) throw new JobError('VALIDATION_FAILED', false, null, 'kind_mismatch');
  return row;
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof JobError) return error.retryable;
  if (isAppError(error)) return error.retryable;
  return true;
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof JobError) return error.code;
  if (isAppError(error)) return error.code;
  return 'HANDLER_ERROR';
}

/** Marks the request `failed` (honestly) when this attempt is the last one, then rethrows. */
export async function failIfFinal(
  repo: PrivacyRepo,
  ctx: JobContext<unknown>,
  requestId: string,
  error: unknown,
): Promise<never> {
  if (!isRetryable(error) || ctx.job.attempts >= ctx.job.max_attempts) {
    await repo
      .updateDeletionRequest(requestId, { status: 'failed', errorCode: errorCodeOf(error) })
      .catch(() => undefined);
  }
  throw error;
}

function pendingPaths(job: unknown): Partial<Record<PrivateBucket, string[]>> {
  const progress = (job as { progress?: unknown }).progress;
  const pending = (progress as { pending_storage?: unknown } | null | undefined)?.pending_storage;
  if (typeof pending !== 'object' || pending === null) return {};
  const out: Partial<Record<PrivateBucket, string[]>> = {};
  for (const bucket of PRIVATE_BUCKETS) {
    const list = (pending as Record<string, unknown>)[bucket];
    if (Array.isArray(list)) out[bucket] = list.filter((p): p is string => typeof p === 'string');
  }
  return out;
}

export async function removePaths(
  store: ObjectStore,
  paths: Partial<Record<PrivateBucket, string[]>>,
): Promise<number> {
  let removed = 0;
  for (const bucket of PRIVATE_BUCKETS) {
    const list = paths[bucket] ?? [];
    if (list.length > 0) removed += await removeInBatches(store, bucket, list);
  }
  return removed;
}

function countsOf(deleted: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0));
}

export async function runHistoryDeletionJob(
  deps: DeletionJobDeps,
  ctx: JobContext<DeletionJobPayload>,
): Promise<JobResult> {
  const row = await loadDeletionRequest(deps.repo, ctx.payload, 'history');
  if (row === null) return { skipped: 'request_gone' };
  if (row.status === 'completed' || row.status === 'cancelled')
    return { skipped: `status_${row.status}` };
  if (row.user_id === null) return { skipped: 'account_deleted' };
  if (ctx.payload.user_id !== undefined && ctx.payload.user_id !== row.user_id) {
    throw new JobError('FORBIDDEN', false, null, 'user_mismatch');
  }
  const userId = row.user_id;
  const accountId = row.scope === 'connected_account' ? row.connected_account_id : null;
  const steps = { ...row.steps };
  try {
    if (row.status !== 'processing') {
      await deps.repo.updateDeletionRequest(row.id, {
        status: 'processing',
        steps: { started_at: ctx.now().toISOString(), scope: row.scope ?? 'all_analysis' },
      });
    }
    let counts: Record<string, number> = {};
    let paths = pendingPaths(ctx.job);
    if (steps.db_purged !== 'done') {
      // A connected account that is already gone took its content with it (FK cascade).
      const purged: PurgeResult =
        row.scope === 'connected_account' && accountId === null
          ? { deleted: {}, storage_paths: {} }
          : await deps.repo.purgeHistory(userId, accountId);
      counts = countsOf(purged.deleted);
      paths = purged.storage_paths;
      await ctx.progress({ pending_storage: paths as unknown as Json });
      await deps.repo.updateDeletionRequest(row.id, {
        steps: { db_purged: 'done', embeddings_purged: 'done', counts },
      });
    } else if (typeof steps.counts === 'object' && steps.counts !== null) {
      counts = steps.counts as Record<string, number>;
    }
    let removed = 0;
    if (steps.storage_purged !== 'done') {
      removed = await removePaths(deps.store, paths);
      await deps.repo.updateDeletionRequest(row.id, {
        steps: { storage_purged: 'done', objects_removed: removed },
      });
    }
    await deps.repo.updateDeletionRequest(row.id, {
      status: 'completed',
      steps: { completed_at: ctx.now().toISOString() },
    });
    await deps.audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.privacy.history_deletion_completed',
      targetType: 'data_deletion_request',
      targetId: row.id,
      targetUserId: userId,
      result: 'success',
      details: { scope: row.scope ?? 'all_analysis', objects_removed: removed, ...counts },
      correlationId: ctx.correlationId,
    });
    await ctx.enqueue(
      notificationBuildJob(userId, {
        category: 'account',
        dedupe_key: `history_deleted:${row.id}`,
        entity: null,
        deeplink: toDeepLink('/settings/privacy/history'),
        template_key: 'account.history_deleted',
        params_public: {},
        params_sensitive: {},
        urgency: 'normal',
        time_sensitive: false,
        vip: false,
      }),
    );
    return { status: 'completed', objects_removed: removed, ...counts };
  } catch (error) {
    return await failIfFinal(deps.repo, ctx as JobContext<unknown>, row.id, error);
  }
}
