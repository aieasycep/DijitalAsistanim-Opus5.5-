/**
 * `calendar_create` execution (IMPLEMENTATION_PLAN T-6.03; API_CONTRACTS §6.4). Google inserts with
 * the deterministic event id `da` + base32hex(approval id) and `extendedProperties.private.
 * da_approval_id` (a duplicate insert answers 409, which the adapter reports as `already_exists`);
 * Graph sends `transactionId = approval id` plus the extended property. On a retry the adapter's
 * `findEventByMarker` runs first. `sendUpdates='all'` only when the approval lists attendees (the
 * side effect is on the card). Device calendars run on the device (T-6.05). Afterwards the calendar
 * is re-synced so the timeline shows provider data (F-10).
 */
import type { EventTime as ProviderEventTime, EventWriteSpec, WriteOutcome } from '@da/domain';
import { addDaysToLocalDate } from '@da/domain';
import {
  calendarSync,
  insightRefresh,
  openDestination,
  outcomeResult,
  toFailure,
} from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

type PayloadTime =
  | { kind: 'timed'; start: string; end: string; time_zone: string }
  | {
      kind: 'all_day';
      start_date: string;
      end_date: string;
    };

export function providerTime(time: PayloadTime): {
  start: ProviderEventTime;
  end: ProviderEventTime;
} {
  if (time.kind === 'timed') {
    return {
      start: { dateTime: new Date(time.start).toISOString(), timeZone: time.time_zone },
      end: { dateTime: new Date(time.end).toISOString(), timeZone: time.time_zone },
    };
  }
  return { start: { date: time.start_date }, end: { date: time.end_date } };
}

/** The probe window around the event (±1 day). */
export function aroundWindow(time: PayloadTime): { start: string; end: string } {
  if (time.kind === 'timed') {
    return {
      start: new Date(Date.parse(time.start) - 86_400_000).toISOString(),
      end: new Date(Date.parse(time.end) + 86_400_000).toISOString(),
    };
  }
  return {
    start: `${addDaysToLocalDate(time.start_date, -1)}T00:00:00Z`,
    end: `${addDaysToLocalDate(time.end_date, 1)}T00:00:00Z`,
  };
}

export async function executeCalendarCreate(env: ExecEnv): Promise<ExecOutcome> {
  const payload = env.approval.payload;
  if (payload.action_type !== 'calendar_create' || payload.target.kind !== 'provider') {
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
  const calendar = await env.repo.calendar(env.approval.user_id, target.calendar_id);
  if (calendar === null) throw new ExecutionFailure('SOURCE_GONE', false, null, 'calendar_gone');
  const times = providerTime(payload.time);
  const spec: EventWriteSpec = {
    providerCalendarId: calendar.provider_calendar_id,
    title: payload.title,
    description: payload.description ?? null,
    start: times.start,
    end: times.end,
    location: payload.location ?? null,
    attendees: payload.attendees.map((a) => ({ address: a.email, name: null })),
    sendUpdates: payload.attendees.length > 0 ? 'all' : 'none',
    reminderMinutes: payload.reminders_minutes.slice(0, 5),
    marker: env.marker,
  };
  let outcome: WriteOutcome | null = null;
  try {
    if (env.probeFirst) {
      outcome = await calendarApi.findEventByMarker(
        session.ctx,
        calendar.provider_calendar_id,
        env.marker,
        aroundWindow(payload.time),
      );
    }
    if (outcome === null) outcome = await calendarApi.createEvent(session.ctx, spec);
  } catch (error) {
    const failure = toFailure(error);
    if (failure.code !== 'STATE_CONFLICT') throw failure;
    // 409 on the deterministic id: the event exists already (API_CONTRACTS §2.7).
    const existing = await calendarApi
      .findEventByMarker(
        session.ctx,
        calendar.provider_calendar_id,
        env.marker,
        aroundWindow(payload.time),
      )
      .catch((e: unknown) => {
        throw toFailure(e);
      });
    outcome = existing ?? { kind: 'already_exists', providerId: env.marker.googleEventId };
  }
  return {
    providerRef:
      account.provider === 'microsoft' ? env.marker.graphTransactionId : env.marker.googleEventId,
    result: outcomeResult(outcome, { target: 'provider', provider: account.provider }),
    followUps: [
      calendarSync(account, calendar.id),
      insightRefresh(env.approval.user_id, 'calendar'),
    ],
  };
}
