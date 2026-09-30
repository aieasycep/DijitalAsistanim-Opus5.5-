/**
 * Meeting data (M-MEET-01…05, M-PLAN-09): the calendar event (explicit columns; attendees as
 * stored), the user's notes for it, and the prep from `POST /meetings/:eventId/prep` (R-23: a
 * precomputed prep answers 200; otherwise it is generated on open and polled every 2 s up to 60 s,
 * then shown as failed with "Tekrar Dene").
 * The same meeting seen through several accounts is one event (KPL-15 cross-source merge): RLS hides
 * the duplicates, `merge_sources` lists every source of the canonical row, and a link that names a
 * duplicate is resolved with `calendar_event_canonical_id`.
 */
import { ApiError, qk } from '@da/api-client';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { callRpc, errorCodeOf, unwrap, unwrapMaybe } from '../../lib/data/rpc';

const Attendee = z.looseObject({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  response: z.string().nullable().optional(),
  is_self: z.boolean().nullable().optional(),
  contact_id: z.string().nullable().optional(),
});
export type AttendeeData = z.infer<typeof Attendee>;

const MergeSource = z.looseObject({
  event_id: z.string(),
  provider: z.string(),
  connected_account_id: z.string(),
  calendar_id: z.string(),
});
export type EventSource = z.infer<typeof MergeSource>;

export interface CalendarEventDetail {
  readonly id: string;
  readonly title: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly location: string | null;
  readonly conferenceUrl: string | null;
  readonly attendees: readonly AttendeeData[];
  readonly attendeeCount: number;
  readonly organizerSelf: boolean;
  readonly canModify: boolean;
  readonly description: string | null;
  readonly provider: string;
  readonly calendarId: string;
  readonly accountId: string;
  readonly calendarName: string | null;
  readonly daApprovalId: string | null;
  readonly status: string;
  readonly syncedAt: string | null;
  /** Every source of a merged event (canonical first); empty when the event has one source. */
  readonly sources: readonly EventSource[];
}

export interface MeetingNote {
  readonly id: string;
  readonly body: string;
  readonly kind: string;
  readonly createdAt: string;
}

const EVENT_COLUMNS =
  'id,title,start_at,end_at,all_day,location,conference_url,attendees,attendee_count,organizer_self,can_modify,description_excerpt,provider,calendar_id,connected_account_id,da_approval_id,status,provider_updated_at,device_last_synced_at,merge_sources';

async function eventRow(id: string) {
  const supabase = getSupabase();
  const found = unwrapMaybe(
    await supabase.from('calendar_events').select(EVENT_COLUMNS).eq('id', id).maybeSingle(),
  );
  if (found !== null) return found;
  // A merged duplicate (hidden by RLS): open its canonical event instead.
  let canonical: unknown = null;
  try {
    canonical = await callRpc('calendar_event_canonical_id', { p_event_id: id });
  } catch (error) {
    if (errorCodeOf(error) !== 'NOT_FOUND') throw error;
  }
  if (typeof canonical !== 'string' || canonical === id) {
    throw new ApiError({ code: 'NOT_FOUND', kind: 'server', status: 404, message: 'no rows' });
  }
  return unwrap(
    await supabase.from('calendar_events').select(EVENT_COLUMNS).eq('id', canonical).single(),
  );
}

export async function fetchEvent(id: string): Promise<CalendarEventDetail> {
  const supabase = getSupabase();
  const row = await eventRow(id);
  const calendar = unwrapMaybe(
    await supabase.from('calendars').select('name').eq('id', row.calendar_id).maybeSingle(),
  );
  const attendees = z.array(Attendee).safeParse(row.attendees);
  const sources = z.array(MergeSource).safeParse(row.merge_sources);
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day,
    location: row.location,
    conferenceUrl: row.conference_url,
    attendees: attendees.success ? attendees.data : [],
    attendeeCount: row.attendee_count,
    organizerSelf: row.organizer_self,
    canModify: row.can_modify,
    description: row.description_excerpt,
    provider: row.provider,
    calendarId: row.calendar_id,
    accountId: row.connected_account_id,
    calendarName: calendar?.name ?? null,
    daApprovalId: row.da_approval_id,
    status: row.status,
    syncedAt: row.device_last_synced_at ?? row.provider_updated_at,
    sources: sources.success ? sources.data : [],
  };
}

export function eventOptions(id: string) {
  return queryOptions({
    queryKey: qk.events.detail(id),
    queryFn: () => fetchEvent(id),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export function notesOptions(eventId: string) {
  return queryOptions({
    queryKey: qk.meetings.notes(eventId),
    queryFn: async (): Promise<MeetingNote[]> =>
      unwrap(
        await getSupabase()
          .from('meeting_notes')
          .select('id,body,kind,created_at')
          .eq('calendar_event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(20),
      ).map((n) => ({ id: n.id, body: n.body, kind: n.kind, createdAt: n.created_at })),
    staleTime: 60_000,
  });
}

/** A meeting has at least one attendee other than the user, or an online link. */
export function isMeeting(
  event: Pick<CalendarEventDetail, 'attendeeCount' | 'conferenceUrl'>,
): boolean {
  return event.attendeeCount >= 2 || event.conferenceUrl !== null;
}

export const PREP_POLL_MS = 2_000;
export const PREP_TIMEOUT_MS = 60_000;
export const PREP_SLOW_MS = 20_000;

export interface PrepSourceRef {
  readonly source_type: string;
  readonly source_id: string | null;
  readonly open_route?: string | undefined;
}

/** The in-app screen a prep source opens (only routes that exist), else null (source sheet). */
export function prepSourcePath(
  ref: PrepSourceRef,
  isAvailable: (path: string) => boolean,
): string | null {
  const route = ref.open_route?.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '/');
  if (route?.startsWith('/') === true && isAvailable(route)) return route;
  if (ref.source_id === null) return null;
  const byType: Readonly<Record<string, string>> = {
    email_message: `/mail/${ref.source_id}`,
    calendar_event: `/event/${ref.source_id}`,
    commitment: `/commitments/${ref.source_id}`,
    capture: `/capture/${ref.source_id}`,
    contact: `/person/${ref.source_id}`,
  };
  const path = byType[ref.source_type];
  return path !== undefined && isAvailable(path) ? path : null;
}

export type MinutesBucket = '<15' | '15-30' | '30-120' | '>120' | 'started' | 'ended';

export function minutesToStartBucket(startMs: number, endMs: number, nowMs: number): MinutesBucket {
  if (nowMs >= endMs) return 'ended';
  if (nowMs >= startMs) return 'started';
  const minutes = (startMs - nowMs) / 60_000;
  if (minutes < 15) return '<15';
  if (minutes <= 30) return '15-30';
  if (minutes <= 120) return '30-120';
  return '>120';
}

export function hoursSinceEndBucket(endMs: number, nowMs: number): '<1' | '1-4' | '4-24' | '>24' {
  const hours = Math.max(0, nowMs - endMs) / 3_600_000;
  if (hours < 1) return '<1';
  if (hours < 4) return '1-4';
  if (hours <= 24) return '4-24';
  return '>24';
}
