/**
 * JOB-12 `insight_refresh` (IMPLEMENTATION_PLAN T-5.05; API_CONTRACTS §11): a deterministic
 * recompute of the user's insights (calendar intelligence, follow-up aging, deadlines, commitments,
 * life events, approvals digest), upsert by `(user_id, dedupe_key)`, expiry of stale ones, follow-up
 * state patches and notification candidates for JOB-18.
 *
 * The job key is coalesced per user (`insight_refresh:{user}:pending`), so a pending refresh may
 * stand for several producers with different scopes; the handler therefore always rebuilds every
 * source (`scope` is kept as the trigger hint). Before the snapshot, the user's Android
 * notification signals not yet linked to an event become (or merge into) `life_events`
 * (API-ANI-01; `_shared/services/life/android.ts`).
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobContext } from '../../_shared/jobs/types.ts';
import { buildInsights } from '../../_shared/services/insights/build.ts';
import { refreshAndroidLifeEvents } from '../../_shared/services/life/android.ts';
import { enqueueNotification, type IntelDeps } from './intel.ts';

export const InsightRefreshPayload = z.object({
  user_id: Uuid,
  scope: z.enum(['mail', 'calendar', 'tasks', 'life', 'followups', 'all']),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().max(40),
});
export type InsightRefreshPayload = z.infer<typeof InsightRefreshPayload>;

export async function runInsightRefresh(
  deps: IntelDeps,
  ctx: JobContext<InsightRefreshPayload>,
): Promise<Record<string, number | string>> {
  const userId = ctx.payload.user_id;
  const now = ctx.now();
  const user = await deps.ai.users.load(userId);
  const android =
    deps.android === undefined
      ? null
      : await refreshAndroidLifeEvents(deps.android, {
          userId,
          locale: user.locale,
          timeZone: user.timeZone,
          now,
        });
  const snapshot = await deps.insights.snapshot(userId, now);
  const result = buildInsights(snapshot, {
    userId,
    locale: user.locale,
    timeZone: user.timeZone,
    now,
    isPro: user.isPro,
    followUpAfterDays: user.followUpAfterDays,
    workingHours: user.workingHours,
    scope: 'all',
  });
  const saved = await deps.insights.upsertInsights(result.upserts);
  await deps.insights.expireInsights(userId, result.expire);
  await deps.insights.updateThreads(result.threadPatches);
  for (const build of result.notifications) await enqueueNotification(ctx, userId, build);
  return {
    scope: ctx.payload.scope,
    upserted: saved.length,
    expired: result.expire.length,
    threads: result.threadPatches.length,
    notifications: result.notifications.length,
    ...(android === null
      ? {}
      : { android_signals: android.signals, android_linked: android.linked }),
  };
}

export function insightRefreshJob(deps: IntelDeps) {
  return defineJob({
    type: 'insight_refresh',
    payload: InsightRefreshPayload,
    handler: async (ctx) => ({ ...(await runInsightRefresh(deps, ctx)) }),
  });
}
