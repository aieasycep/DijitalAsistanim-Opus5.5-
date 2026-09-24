/**
 * Post-meeting prompt (M§22, API_CONTRACTS §11.3): "Toplantın bitti. Takip etmen gereken bir şey var
 * mı?" one minute after a meeting with attendees ends (Pro). Silent on iOS (`passive`, no sound);
 * the tap opens the post-meeting capture. Stale two hours after the meeting.
 */
import { routes, toDeepLink } from '@da/domain';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export const POST_MEETING_DELAY_MS = 60_000;
export const POST_MEETING_VALID_MS = 2 * 3_600_000;

export async function postMeetingTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const eventId = ctx.payload.event_id;
  if (eventId === undefined) return skip('missing_event');
  const event = await ctx.repo.event(ctx.userId, eventId);
  if (event === null || event.status === 'cancelled' || event.provider_deleted_at !== null) {
    return skip('event_gone');
  }
  if (event.attendee_count < 1 || event.all_day) return skip('not_a_meeting');
  const end = new Date(event.end_at);
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'meeting',
      dedupeKey: `post_meeting:${event.id}`,
      template: 'meeting',
      variant: 'post',
      urgency: 'today',
      entityType: 'calendar_event',
      entityId: event.id,
      deeplink: toDeepLink(routes.meetingPost(event.id)),
      paramsSensitive: event.title === null ? {} : { meeting: event.title },
      scheduledFor: new Date(end.getTime() + POST_MEETING_DELAY_MS),
      validUntil: new Date(end.getTime() + POST_MEETING_VALID_MS),
      interruption: 'passive',
      sound: false,
      entitled: ctx.isPro,
    }),
  };
}
