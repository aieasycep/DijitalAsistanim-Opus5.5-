/**
 * JOB-20 `retention` (API_CONTRACTS §11.4; SECURITY_AND_PRIVACY_PLAN §4.5; DATABASE_AND_RLS_PLAN §6.4;
 * IMPLEMENTATION_PLAN T-11.04; M§41, M§96).
 *
 * - Daily sweep (pg_cron `da_retention` → `retention:{utc_date}`): `retention_cleanup(5000, now)`
 *   deletes rows past `expires_at` in batches of 5,000 per table (memory chunks, i.e. embeddings,
 *   included; the AFTER DELETE triggers of 20260924002510 take the chunks of every deleted source
 *   with it) plus the system TTLs, and is called until every count is 0. The returned Storage paths
 *   are removed through the Storage API in batches of 100. Then the orphan-object sweep
 *   (`retention_orphan_objects`) and the system schedules outside that function
 *   (`retention_system_sweep`). The run is audited as `system.retention.run` with counts only.
 * - Recompute (`trg_user_preferences_retention_changed` → `{mode:'recompute', user_id}` or the
 *   contract form `{recompute:true, user_id}`): `recompute_expires_at(user, 5000)` until 0, so a
 *   shorter period takes effect at the next sweep (within 24 hours).
 * - A run that exhausts its time budget enqueues a continuation with the same payload.
 */
import type { AuditWriter } from '../audit.ts';
import type { JobContext, JobResult } from '../../jobs/types.ts';
import type { PrivacyRepo } from './repo.ts';
import { type ObjectStore, PRIVATE_BUCKETS, removeInBatches } from './storage.ts';

export const RETENTION_BATCH = 5000;
export const RETENTION_BUDGET_MS = 180_000;
const ORPHAN_LIMIT = 1000;

export interface RetentionJobDeps {
  readonly repo: PrivacyRepo;
  readonly store: ObjectStore;
  readonly audit: AuditWriter;
  readonly budgetMs?: number;
  /** Monotonic clock for the budget (tests inject one). */
  readonly clock?: () => number;
}

export interface RetentionPayload {
  readonly mode?: 'sweep' | 'recompute' | undefined;
  readonly recompute?: boolean | undefined;
  readonly user_id?: string | null | undefined;
  readonly batch_size?: number | undefined;
}

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
}

async function continueLater(ctx: JobContext<RetentionPayload>, tag: string): Promise<void> {
  await ctx.enqueue({
    type: 'retention',
    idempotencyKey: `${ctx.job.idempotency_key}:${tag}:${ctx.job.id}`.slice(0, 200),
    payload: { ...ctx.payload } as Record<string, string | number | boolean | null>,
    userId: ctx.job.user_id,
    priority: 150,
    maxAttempts: 5,
  });
}

export async function runRetentionJob(
  deps: RetentionJobDeps,
  ctx: JobContext<RetentionPayload>,
): Promise<JobResult> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? RETENTION_BUDGET_MS;
  const batch = Math.min(Math.max(ctx.payload.batch_size ?? RETENTION_BATCH, 1), RETENTION_BATCH);
  const recompute = ctx.payload.mode === 'recompute' || ctx.payload.recompute === true;

  if (recompute) {
    const userId = ctx.payload.user_id ?? ctx.job.user_id;
    if (userId === null || userId === undefined) return { skipped: 'no_user' };
    let updated = 0;
    for (;;) {
      const n = await deps.repo.recomputeExpiresAt(userId, batch);
      updated += n;
      if (n === 0) return { mode: 'recompute', updated };
      if (clock() - started > budget) {
        await continueLater(ctx, 'c');
        return { mode: 'recompute', updated, continued: true };
      }
    }
  }

  const deleted: Record<string, number> = {};
  let objectsRemoved = 0;
  let objectFailures = 0;
  const removeAll = async (paths: Partial<Record<string, string[]>>) => {
    for (const bucket of PRIVATE_BUCKETS) {
      const list = paths[bucket] ?? [];
      if (list.length === 0) continue;
      try {
        objectsRemoved += await removeInBatches(deps.store, bucket, list);
      } catch {
        // The rows are gone; the orphan sweep of the next run removes what is left.
        objectFailures += list.length;
      }
    }
  };

  for (;;) {
    const result = await deps.repo.retentionCleanup(batch, ctx.now());
    add(deleted, result.deleted);
    await removeAll(result.storage_paths);
    const more = Object.values(result.deleted).some((n) => n > 0);
    if (!more) break;
    if (clock() - started > budget) {
      await continueLater(ctx, 'c');
      return { mode: 'sweep', continued: true, objects_removed: objectsRemoved, ...deleted };
    }
  }
  await removeAll(await deps.repo.orphanObjects(ctx.now(), ORPHAN_LIMIT));
  add(deleted, await deps.repo.systemSweep(batch, ctx.now()));

  const counts = Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0));
  await deps.audit.append({
    actorType: 'system',
    actorId: null,
    action: 'system.retention.run',
    targetType: 'retention',
    targetId: ctx.job.idempotency_key.slice(0, 100),
    targetUserId: null,
    result: objectFailures === 0 ? 'success' : 'failure',
    details: { objects_removed: objectsRemoved, object_failures: objectFailures, ...counts },
    correlationId: ctx.correlationId,
  });
  return {
    mode: 'sweep',
    objects_removed: objectsRemoved,
    object_failures: objectFailures,
    ...counts,
  };
}
