/**
 * `calendar_update` execution (IMPLEMENTATION_PLAN T-6.03; API_CONTRACTS §6.4): Google
 * `events.patch` / Graph `PATCH /me/events/{id}` with `If-Match` = the etag / changeKey seen at the
 * proposal and the `da_last_approval_id` marker. A 412 is `APPROVAL_STALE` (non-retryable; the UI
 * re-proposes from the provider's current times kept in `result.current`). On a retry the event is read first: when it already carries this approval's marker
 * the patch happened. Attendees are notified when the event has any (disclosed on the card).
 */
import type { EventPatchSpec, WriteOutcome } from '@da/domain';
import { providerTime } from './calendar-create.ts';
import {
  calendarSync,
  insightRefresh,
  openDestination,
  outcomeResult,
  toFailure,
} from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

export async function executeCalendarUpdate(env: ExecEnv): Promise<ExecOutcome> {
  const approval = env.approval;
  const payload = approval.payload;
  if (payload.action_type !== 'calendar_update' || payload.target.kind !== 'provider') {
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'not_a_server_target');
  }
  const target = payload.target;
  const { session, account } = await openDestination(
    env,
    target.connected_account_id,
    'calendar_write',
  );
  const calendarApi = session.adapters.calendar;
  if (calendarApi === undefined)
    throw new ExecutionFailure('FEATURE_DISABLED', false, null, 'calendar_adapter');
  const [calendar, event] = await Promise.all([
    env.repo.calendar(approval.user_id, target.calendar_id),
    env.repo.calendarEvent(approval.user_id, payload.calendar_event_id),
  ]);
  if (calendar === null || event === null || event.provider_deleted_at !== null) {
    throw new ExecutionFailure('SOURCE_GONE', false, null, 'event_gone');
  }
  const changes = payload.changes;
  const times = changes.time === undefined ? null : providerTime(changes.time);
  const spec: EventPatchSpec = {
    providerCalendarId: calendar.provider_calendar_id,
    providerEventId: event.provider_event_id,
    expectedEtag: approval.exact_change.card.precondition ?? event.etag,
    ...(times === null ? {} : { start: times.start, end: times.end }),
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.location === undefined ? {} : { location: changes.location }),
    ...(changes.description === undefined ? {} : { description: changes.description }),
    sendUpdates: event.attendee_count > 0 ? 'all' : 'none',
    marker: env.marker,
  };
  let outcome: WriteOutcome | null = null;
  try {
    if (env.probeFirst) {
      const current = await calendarApi.getEvent(
        session.ctx,
        calendar.provider_calendar_id,
        event.provider_event_id,
      );
      if (current === null) throw new ExecutionFailure('SOURCE_GONE', false, null, 'event_gone');
      if (current.daApprovalId === approval.id)
        outcome = { kind: 'updated', providerId: current.providerEventId };
    }
    if (outcome === null) outcome = await calendarApi.updateEvent(session.ctx, spec);
  } catch (error) {
    const failure = toFailure(error);
    if (failure.code !== 'APPROVAL_STALE') throw failure;
    // 412: keep the provider's current times so the card can re-propose from them (IT-APR-11).
    const current = await calendarApi
      .getEvent(session.ctx, calendar.provider_calendar_id, event.provider_event_id)
      .catch(() => null);
    throw new ExecutionFailure(failure.code, false, null, failure.message, {
      current:
        current === null
          ? null
          : {
              etag: current.etag,
              status: current.status,
              start: 'dateTime' in current.start ? current.start.dateTime : current.start.date,
              end: 'dateTime' in current.end ? current.end.dateTime : current.end.date,
              time_zone: 'dateTime' in current.start ? current.start.timeZone : null,
            },
    });
  }
  return {
    providerRef: event.provider_event_id,
    result: outcomeResult(outcome, { target: 'provider', provider: account.provider }),
    followUps: [calendarSync(account, calendar.id), insightRefresh(approval.user_id, 'calendar')],
  };
}
