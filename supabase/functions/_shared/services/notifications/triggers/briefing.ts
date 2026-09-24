/**
 * Briefing delivered (M§9–12, JOB-14 follow-up): once a briefing is `ready` the briefing job enqueues
 * `briefingJob`; the push says "Günaydın" / "Bugün bilmen gereken {n} şey var." (morning),
 * "Sabahından beri {n} önemli gelişme oldu." (midday), "Bugünden yarına {n} konu kalıyor." (evening)
 * or "Haftalık özetin hazır." (weekly, category `evening` on channel `briefings`). A briefing more
 * than 90 minutes late is dropped (`late_delivery`); a sent push marks the briefing `delivered`.
 */
import { briefingNotificationDedupeKey, routes, toDeepLink } from '@da/domain';
import type { EnqueueInput } from '../../../jobs/types.ts';
import { baseSpec, notificationTriggerJob } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

/** The job the briefing pipeline enqueues when a briefing becomes `ready`. */
export function briefingJob(userId: string, briefingId: string): EnqueueInput {
  return notificationTriggerJob(
    userId,
    `briefing_notify:${briefingId}`,
    { trigger: 'briefing', briefing_id: briefingId },
    { priority: 20 },
  );
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

/** The headline count of a briefing (`counts.headline` → `counts.total` → `counts.items` → sum). */
export function headlineCount(counts: Readonly<Record<string, unknown>>): number {
  const direct = num(counts.headline) ?? num(counts.total) ?? num(counts.items);
  if (direct !== null) return direct;
  return Object.values(counts).reduce<number>((sum, v) => sum + (num(v) ?? 0), 0);
}

export async function briefingTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const id = ctx.payload.briefing_id;
  if (id === undefined) return skip('missing_briefing');
  const briefing = await ctx.repo.briefing(ctx.userId, id);
  if (briefing === null || briefing.status !== 'ready') return skip('not_ready');
  const count = headlineCount(briefing.counts);
  const weekly = briefing.kind === 'weekly';
  const category = weekly ? 'evening' : briefing.kind;
  let variant: string;
  let paramsPublic: Record<string, number> = { count };
  if (weekly) {
    variant = 'ready';
    const stats = briefing.weekly_stats ?? {};
    paramsPublic = {
      important: num(stats.important) ?? num(stats.important_subjects) ?? 0,
      meetings: num(stats.meetings) ?? 0,
      followups: num(stats.followups) ?? num(stats.follow_ups) ?? 0,
    };
  } else if (briefing.kind === 'morning') {
    variant = count > 0 ? 'ready' : 'calm';
  } else if (briefing.kind === 'evening') {
    variant = count > 0 ? 'ready' : 'clear';
  } else {
    if (count === 0) return skip('no_meaningful_delta');
    variant = 'ready';
  }
  return {
    kind: 'spec',
    spec: baseSpec({
      category,
      dedupeKey: briefingNotificationDedupeKey(briefing.id),
      template: weekly ? 'weekly' : category,
      variant,
      urgency: 'today',
      entityType: 'briefing',
      entityId: briefing.id,
      deeplink: toDeepLink(weekly ? routes.weekly(briefing.id) : routes.briefing(briefing.id)),
      paramsPublic,
      paramsSensitive: briefing.headline === null ? {} : { highlights: briefing.headline },
      scheduledFor: new Date(briefing.scheduled_for),
      entitled: briefing.kind === 'midday' || briefing.kind === 'evening' ? ctx.isPro : true,
    }),
    onSent: (at) => ctx.repo.markBriefingDelivered(ctx.userId, briefing.id, at),
  };
}
