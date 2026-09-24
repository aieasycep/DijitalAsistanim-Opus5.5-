/**
 * Meeting prep push (R-23, API_CONTRACTS §11.3 "Meeting prep reminder"): scheduler_tick enqueues it
 * at the user's lead time inside T−30…T−15 for Pro users with the `meeting` category on. Copy:
 * "{saat} · {toplantı}" / "Toplantına {n} dakika kaldı. {k} hazırlık notun var." in `full`,
 * "Yaklaşan toplantı" / "Toplantına {n} dakika kaldı." below it. Stale once the meeting starts.
 */
import { formatTime, routes, toDeepLink } from '@da/domain';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export async function meetingPrepTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const eventId = ctx.payload.event_id;
  if (eventId === undefined) return skip('missing_event');
  const event = await ctx.repo.event(ctx.userId, eventId);
  if (event === null || event.status === 'cancelled' || event.provider_deleted_at !== null) {
    return skip('event_gone');
  }
  const start = new Date(event.start_at);
  const minutes = Math.round((start.getTime() - ctx.now.getTime()) / 60_000);
  if (minutes <= 0) return skip('meeting_started');
  const prep = await ctx.repo.meetingPrep(ctx.userId, event.id);
  const ready = prep !== null && prep.status === 'ready';
  const startEpoch = Math.floor(start.getTime() / 1000);
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'meeting',
      dedupeKey: `meeting_prep:${event.id}:${startEpoch}`,
      template: 'meeting',
      variant: ready ? 'prep_ready' : 'upcoming',
      urgency: 'today',
      entityType: 'calendar_event',
      entityId: event.id,
      deeplink: toDeepLink(routes.meetingPrep(event.id)),
      paramsPublic: {
        time: formatTime(start, ctx.timeZone),
        minutes,
        ...(ready ? { count: prep?.topics ?? 0 } : {}),
      },
      paramsSensitive: event.title === null ? {} : { meeting: event.title },
      validUntil: start,
      minutesToStart: minutes,
      entitled: ctx.isPro,
    }),
  };
}
