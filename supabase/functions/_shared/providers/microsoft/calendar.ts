/**
 * Graph calendar `CalendarProvider` (INTEGRATION_PLAN §5.5, §3.12; API_CONTRACTS JOB-04, JOB-07; T-4.08):
 * - calendars with `canEdit`, default flag, colour and owner;
 * - `calendarView/delta` per calendar over the rolling window (occurrences arrive expanded; the window
 *   lives in the token), `outlook.timezone="UTC"`; `@removed` → deleted; 410 → `cursor_invalid`;
 *   re-baselined daily by the engine with a shifted window;
 * - event bodies are reduced to a ≤500-char excerpt in memory; `onlineMeeting.joinUrl` kept only for
 *   allow-listed hosts; `transactionId` carries the approval id of events we created;
 * - writes: create with `transactionId = approvalId` (Graph de-duplicates) plus the `da_approval_id`
 *   extended property; update with `If-Match` (412 → `precondition_failed`) and `da_last_approval_id`;
 *   the probe matches `transactionId` inside a calendarView window;
 * - attendee availability with `POST /me/calendar/getSchedule` (`Calendars.Read`; KPL-46): busy,
 *   tentative and out-of-office items are busy; `ErrorMailRecipientNotFound` → `not_found`, no
 *   free/busy access (outside the organisation) → `not_shared`.
 */
import {
  type CalendarChangeSet,
  type CalendarCursor,
  type CalendarProvider,
  type CalendarWindow,
  checkConferencingUrl,
  type EventPatchSpec,
  type FreeBusyAnswer,
  type FreeBusyError,
  type FreeBusyQuery,
  type EventTime,
  type EventWriteSpec,
  type IdempotencyMarker,
  type NormalizedCalendar,
  type NormalizedEvent,
  type ProviderContext,
  ProviderError,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { excerpt, excerptOrNull, isoOrNull } from '../common.ts';
import { DA_APPROVAL_PROPERTY_ID, DA_LAST_APPROVAL_PROPERTY_ID } from './config.ts';
import type { GraphClient } from './graph.ts';
import type { GraphSubscriptions } from './subscriptions.ts';

interface GraphDateTime {
  readonly dateTime?: string;
  readonly timeZone?: string;
}

interface GraphEvent {
  readonly id: string;
  readonly '@removed'?: { reason?: string };
  readonly '@odata.etag'?: string;
  readonly iCalUId?: string;
  readonly seriesMasterId?: string;
  readonly type?: string;
  readonly originalStart?: string;
  readonly subject?: string;
  readonly bodyPreview?: string;
  readonly body?: { contentType?: string; content?: string };
  readonly location?: { displayName?: string };
  readonly start?: GraphDateTime;
  readonly end?: GraphDateTime;
  readonly isAllDay?: boolean;
  readonly isCancelled?: boolean;
  readonly showAs?: string;
  readonly sensitivity?: string;
  readonly organizer?: { emailAddress?: { address?: string; name?: string } };
  readonly isOrganizer?: boolean;
  readonly attendees?: {
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
    type?: string;
  }[];
  readonly onlineMeeting?: { joinUrl?: string } | null;
  readonly changeKey?: string;
  readonly lastModifiedDateTime?: string;
  readonly transactionId?: string | null;
  readonly webLink?: string;
  readonly responseStatus?: { response?: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Graph `{dateTime, timeZone}` in UTC (the `outlook.timezone="UTC"` preference) → an instant. */
function instant(value: GraphDateTime | undefined): string | null {
  if (value?.dateTime === undefined) return null;
  const tz = value.timeZone ?? 'UTC';
  const hasOffset = /[zZ]|[+-]\d\d:?\d\d$/.test(value.dateTime);
  return isoOrNull(hasOffset || tz !== 'UTC' ? value.dateTime : `${value.dateTime}Z`);
}

function eventTime(value: GraphDateTime | undefined, allDay: boolean): EventTime {
  if (allDay) return { date: (value?.dateTime ?? '1970-01-01').slice(0, 10) };
  return { dateTime: instant(value) ?? new Date(0).toISOString(), timeZone: 'UTC' };
}

const RESPONSE: Readonly<Record<string, NormalizedEvent['attendees'][number]['responseStatus']>> = {
  accepted: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
  notResponded: 'needs_action',
  none: null,
  organizer: 'accepted',
};

export function normalizeGraphEvent(
  event: GraphEvent,
  providerCalendarId: string,
  selfEmail: string | null,
): NormalizedEvent {
  const allDay = event.isAllDay === true;
  const organizer = event.organizer?.emailAddress?.address?.toLowerCase() ?? null;
  const join = event.onlineMeeting?.joinUrl;
  const conference = join === undefined ? null : checkConferencingUrl(join);
  const sensitivity = event.sensitivity;
  const description =
    event.body?.content !== undefined
      ? excerptOrNull(event.body.content, 500)
      : excerptOrNull(event.bodyPreview, 500);
  return {
    providerEventId: event.id,
    providerCalendarId,
    iCalUid: event.iCalUId ?? null,
    seriesMasterId: event.seriesMasterId ?? null,
    originalStart:
      event.originalStart === undefined
        ? null
        : { dateTime: isoOrNull(event.originalStart) ?? event.originalStart, timeZone: 'UTC' },
    isOccurrence: event.type === 'occurrence' || event.type === 'exception',
    status:
      event.isCancelled === true
        ? 'cancelled'
        : event.showAs === 'tentative'
          ? 'tentative'
          : 'confirmed',
    title: excerpt(event.subject ?? '', 300),
    descriptionSnippet: description,
    location: excerptOrNull(event.location?.displayName, 300),
    start: eventTime(event.start, allDay),
    end: eventTime(event.end, allDay),
    allDay,
    organizer:
      organizer === null
        ? null
        : { address: organizer, name: event.organizer?.emailAddress?.name ?? null },
    userIsOrganizer: event.isOrganizer === true,
    attendees: (event.attendees ?? [])
      .filter((a) => a.emailAddress?.address !== undefined)
      .slice(0, 100)
      .map((a) => {
        const email = (a.emailAddress?.address ?? '').toLowerCase();
        return {
          email,
          name: a.emailAddress?.name ?? null,
          responseStatus: RESPONSE[a.status?.response ?? 'none'] ?? null,
          isSelf: selfEmail !== null && email === selfEmail.toLowerCase(),
          isOrganizer: email === organizer,
        };
      }),
    conferenceUrl: conference?.ok === true ? conference.url : null,
    transparency: event.showAs === 'free' ? 'free' : 'busy',
    visibility:
      sensitivity === 'private'
        ? 'private'
        : sensitivity === 'confidential'
          ? 'confidential'
          : sensitivity === 'personal'
            ? 'private'
            : 'default',
    etag: event['@odata.etag'] ?? event.changeKey ?? null,
    updatedAt: isoOrNull(event.lastModifiedDateTime ?? null),
    daApprovalId:
      typeof event.transactionId === 'string' && UUID_RE.test(event.transactionId)
        ? event.transactionId
        : null,
    deleted: event['@removed'] !== undefined || event.isCancelled === true,
  };
}

function toGraphTime(time: EventTime): { dateTime: string; timeZone: string } {
  if ('date' in time) return { dateTime: `${time.date}T00:00:00`, timeZone: 'UTC' };
  return { dateTime: time.dateTime.replace(/Z$/, ''), timeZone: 'UTC' };
}

interface GraphScheduleItem {
  readonly status?: string;
  readonly start?: { dateTime?: string; timeZone?: string };
  readonly end?: { dateTime?: string; timeZone?: string };
}

interface GraphSchedule {
  readonly scheduleId?: string;
  readonly availabilityView?: string;
  readonly scheduleItems?: readonly GraphScheduleItem[];
  readonly error?: { responseCode?: string };
}

const BUSY_STATUSES = new Set(['busy', 'tentative', 'oof']);
/** `availabilityView` digits: 0 free, 1 tentative, 2 busy, 3 out of office, 4 working elsewhere. */
const BUSY_DIGITS = new Set(['1', '2', '3']);
export const GETSCHEDULE_INTERVAL_MIN = 15;

/** A UTC wall time as Graph returns it (`2026-10-05T11:00:00.0000000`, `timeZone: 'UTC'`). */
function utcIso(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return isoOrNull(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}

function scheduleError(code: string | undefined): FreeBusyError {
  if (code === 'ErrorMailRecipientNotFound' || code === 'ErrorInvalidSmtpAddress')
    return 'not_found';
  if (/FreeBusy|Proxy|AccessDenied|NotAllowed/i.test(code ?? '')) return 'not_shared';
  return 'unavailable';
}

/** `getSchedule` response → one answer per requested address (lower-case). */
export function normalizeGraphSchedule(
  emails: readonly string[],
  window: CalendarWindow,
  res: { value?: readonly GraphSchedule[] },
): FreeBusyAnswer[] {
  const byId = new Map((res.value ?? []).map((s) => [(s.scheduleId ?? '').toLowerCase(), s]));
  return emails.map((raw) => {
    const email = raw.toLowerCase();
    const schedule = byId.get(email);
    if (schedule === undefined) return { email, busy: [], error: 'unavailable' as const };
    if (schedule.error !== undefined)
      return { email, busy: [], error: scheduleError(schedule.error.responseCode) };
    const busy: CalendarWindow[] = [];
    if (schedule.scheduleItems !== undefined) {
      for (const item of schedule.scheduleItems) {
        if (!BUSY_STATUSES.has((item.status ?? '').toLowerCase())) continue;
        const start = utcIso(item.start?.dateTime);
        const end = utcIso(item.end?.dateTime);
        if (start !== null && end !== null && Date.parse(end) > Date.parse(start))
          busy.push({ start, end });
      }
    } else {
      const view = schedule.availabilityView ?? '';
      const origin = Date.parse(window.start);
      for (let i = 0; i < view.length; i++) {
        if (!BUSY_DIGITS.has(view[i] ?? '')) continue;
        const start = origin + i * GETSCHEDULE_INTERVAL_MIN * 60_000;
        busy.push({
          start: new Date(start).toISOString(),
          end: new Date(
            Math.min(start + GETSCHEDULE_INTERVAL_MIN * 60_000, Date.parse(window.end)),
          ).toISOString(),
        });
      }
    }
    return { email, busy, error: null };
  });
}

export class GraphCalendarAdapter implements CalendarProvider {
  readonly provider = 'microsoft' as const;
  constructor(
    private readonly graph: GraphClient,
    private readonly subscriptions: GraphSubscriptions,
  ) {}

  async freeBusy(ctx: ProviderContext, q: FreeBusyQuery): Promise<FreeBusyAnswer[]> {
    const emails = [...new Set(q.emails.map((e) => e.trim().toLowerCase()))]
      .filter((e) => e !== '')
      .slice(0, 20);
    if (emails.length === 0) return [];
    const utc = (iso: string) => new Date(iso).toISOString().replace(/Z$/, '');
    const res = await this.graph.json<{ value?: GraphSchedule[] }>(
      ctx,
      '/me/calendar/getSchedule',
      {
        method: 'POST',
        prefer: ['outlook.timezone="UTC"'],
        priority: 'interactive',
        idempotent: true,
        body: {
          schedules: emails,
          startTime: { dateTime: utc(q.window.start), timeZone: 'UTC' },
          endTime: { dateTime: utc(q.window.end), timeZone: 'UTC' },
          availabilityViewInterval: GETSCHEDULE_INTERVAL_MIN,
        },
      },
    );
    return normalizeGraphSchedule(emails, q.window, res);
  }

  async listCalendars(ctx: ProviderContext): Promise<NormalizedCalendar[]> {
    const res = await this.graph.json<{
      value?: {
        id: string;
        name?: string;
        hexColor?: string;
        canEdit?: boolean;
        isDefaultCalendar?: boolean;
        owner?: { address?: string };
      }[];
    }>(ctx, '/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar,owner&$top=100');
    const self = ctx.account.email?.toLowerCase() ?? null;
    return (res.value ?? []).map((c) => {
      const name = (c.name ?? '').slice(0, 200);
      const owned =
        c.owner?.address === undefined || self === null || c.owner.address.toLowerCase() === self;
      const kind: NormalizedCalendar['kind'] =
        c.isDefaultCalendar === true
          ? 'default'
          : /birthday|doğum günü/i.test(name)
            ? 'birthdays'
            : /holiday|tatil/i.test(name)
              ? 'holidays'
              : owned
                ? 'other'
                : 'shared';
      return {
        providerCalendarId: c.id,
        name,
        color: /^#[0-9a-f]{6}$/i.test(c.hexColor ?? '') ? (c.hexColor ?? null) : null,
        timeZone: null,
        accessRole: c.canEdit === true ? (owned ? 'owner' : 'writer') : 'reader',
        isPrimary: c.isDefaultCalendar === true,
        canWrite: c.canEdit === true,
        kind,
        deleted: false,
      };
    });
  }

  async getUserTimeZone(ctx: ProviderContext): Promise<string | null> {
    const res = await this.graph.json<{ value?: string }>(ctx, '/me/mailboxSettings/timeZone');
    // Graph answers Windows zone names unless configured; only IANA names are useful as a suggestion.
    return res.value !== undefined && res.value.includes('/') ? res.value : null;
  }

  private async delta(
    ctx: ProviderContext,
    providerCalendarId: string,
    url: string,
    window: CalendarWindow | undefined,
  ): Promise<CalendarChangeSet> {
    let res: { value?: GraphEvent[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };
    try {
      res = await this.graph.json(ctx, url, {
        prefer: ['odata.maxpagesize=50', 'outlook.timezone="UTC"'],
      });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.httpStatus === 410 ||
          error.code === 'cursor_invalid' ||
          /syncStateNotFound|resyncRequired/i.test(error.providerReason ?? ''))
      ) {
        throw new ProviderError('cursor_invalid', 410, null, 'delta_expired');
      }
      throw error;
    }
    const upserts: NormalizedEvent[] = [];
    const deleted: string[] = [];
    for (const event of res.value ?? []) {
      if (event['@removed'] !== undefined) deleted.push(event.id);
      else upserts.push(normalizeGraphEvent(event, providerCalendarId, ctx.account.email));
    }
    return {
      upserts,
      deleted,
      nextCursor:
        res['@odata.deltaLink'] === undefined
          ? null
          : {
              kind: 'graph_calendar_view_delta',
              value: res['@odata.deltaLink'],
              ...(window === undefined ? {} : { window }),
            },
      pageToken: res['@odata.nextLink'] ?? null,
    };
  }

  async fullSync(
    ctx: ProviderContext,
    providerCalendarId: string,
    window: CalendarWindow,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet> {
    const url =
      pageToken ??
      `/me/calendars/${encodeURIComponent(providerCalendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(window.start)}` +
        `&endDateTime=${encodeURIComponent(window.end)}`;
    return await this.delta(ctx, providerCalendarId, url, window);
  }

  async changesSince(
    ctx: ProviderContext,
    providerCalendarId: string,
    cursor: CalendarCursor,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet> {
    return await this.delta(ctx, providerCalendarId, pageToken ?? cursor.value, cursor.window);
  }

  async expandSeries(
    ctx: ProviderContext,
    providerCalendarId: string,
    seriesMasterId: string,
    window: CalendarWindow,
  ): Promise<NormalizedEvent[]> {
    const res = await this.graph.json<{ value?: GraphEvent[] }>(
      ctx,
      `/me/calendars/${encodeURIComponent(providerCalendarId)}/events/${encodeURIComponent(seriesMasterId)}/instances` +
        `?startDateTime=${encodeURIComponent(window.start)}&endDateTime=${encodeURIComponent(window.end)}&$top=100`,
      { prefer: ['outlook.timezone="UTC"'] },
    );
    return (res.value ?? []).map((e) =>
      normalizeGraphEvent(e, providerCalendarId, ctx.account.email),
    );
  }

  private async fetchEvent(
    ctx: ProviderContext,
    providerEventId: string,
    select?: string,
  ): Promise<GraphEvent | null> {
    try {
      return await this.graph.json<GraphEvent>(
        ctx,
        `/me/events/${encodeURIComponent(providerEventId)}${select === undefined ? '' : `?$select=${select}`}`,
        {
          prefer: ['outlook.timezone="UTC"', 'outlook.body-content-type="text"'],
          priority: 'interactive',
        },
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') return null;
      throw error;
    }
  }

  async getEvent(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
  ): Promise<NormalizedEvent | null> {
    const event = await this.fetchEvent(ctx, providerEventId);
    return event === null
      ? null
      : normalizeGraphEvent(event, providerCalendarId, ctx.account.email);
  }

  async getEventDescription(
    ctx: ProviderContext,
    _providerCalendarId: string,
    providerEventId: string,
    opts: { maxBytes: number },
  ): Promise<string | null> {
    const event = await this.fetchEvent(ctx, providerEventId, 'body');
    return event?.body?.content === undefined ? null : excerpt(event.body.content, opts.maxBytes);
  }

  async watch(ctx: ProviderContext, providerCalendarId: string): Promise<WatchHandle> {
    return await this.subscriptions.create(ctx, {
      resource: `me/calendars/${providerCalendarId}/events`,
      handleResource: 'graph_calendar_view',
      resourceKey: providerCalendarId,
    });
  }

  async renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle> {
    return await this.subscriptions.renew(ctx, handle);
  }

  async reauthorizeWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    await this.subscriptions.reauthorize(ctx, handle);
  }

  async stopWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    await this.subscriptions.remove(ctx, handle);
  }

  async createEvent(ctx: ProviderContext, spec: EventWriteSpec): Promise<WriteOutcome> {
    const allDay = 'date' in spec.start;
    const created = await this.graph.json<{ id: string; webLink?: string }>(
      ctx,
      `/me/calendars/${encodeURIComponent(spec.providerCalendarId)}/events`,
      {
        method: 'POST',
        priority: 'interactive',
        idempotent: false,
        prefer: ['outlook.timezone="UTC"'],
        body: {
          subject: spec.title,
          ...(spec.description === null
            ? {}
            : { body: { contentType: 'text', content: spec.description } }),
          start: toGraphTime(spec.start),
          end: toGraphTime(spec.end),
          isAllDay: allDay,
          ...(spec.location === null ? {} : { location: { displayName: spec.location } }),
          attendees: spec.attendees.map((a) => ({
            emailAddress: { address: a.address, ...(a.name ? { name: a.name } : {}) },
            type: 'required',
          })),
          isReminderOn: spec.reminderMinutes.length > 0,
          ...(spec.reminderMinutes.length > 0
            ? { reminderMinutesBeforeStart: spec.reminderMinutes[0] }
            : {}),
          transactionId: spec.marker.graphTransactionId,
          singleValueExtendedProperties: [
            { id: DA_APPROVAL_PROPERTY_ID, value: spec.marker.approvalId },
          ],
        },
      },
    );
    return { kind: 'created', providerId: created.id, webLink: created.webLink ?? null };
  }

  async updateEvent(ctx: ProviderContext, patch: EventPatchSpec): Promise<WriteOutcome> {
    const body: Record<string, unknown> = {
      singleValueExtendedProperties: [
        { id: DA_LAST_APPROVAL_PROPERTY_ID, value: patch.marker.approvalId },
      ],
    };
    if (patch.start !== undefined) body.start = toGraphTime(patch.start);
    if (patch.end !== undefined) body.end = toGraphTime(patch.end);
    if (patch.title !== undefined) body.subject = patch.title;
    if (patch.location !== undefined) body.location = { displayName: patch.location ?? '' };
    const updated = await this.graph.json<{ id: string }>(
      ctx,
      `/me/events/${encodeURIComponent(patch.providerEventId)}`,
      {
        method: 'PATCH',
        priority: 'interactive',
        idempotent: false,
        body,
        ...(patch.expectedEtag === null ? {} : { headers: { 'If-Match': patch.expectedEtag } }),
      },
    );
    return { kind: 'updated', providerId: updated.id ?? patch.providerEventId };
  }

  async findEventByMarker(
    ctx: ProviderContext,
    providerCalendarId: string,
    marker: IdempotencyMarker,
    around: CalendarWindow,
  ): Promise<WriteOutcome | null> {
    let url: string | null =
      `/me/calendars/${encodeURIComponent(providerCalendarId)}/calendarView?startDateTime=${encodeURIComponent(around.start)}` +
      `&endDateTime=${encodeURIComponent(around.end)}&$select=id,transactionId,webLink,isCancelled&$top=100`;
    for (let page = 0; page < 5 && url !== null; page++) {
      const res: { value?: GraphEvent[]; '@odata.nextLink'?: string } = await this.graph.json(
        ctx,
        url,
        {
          prefer: ['outlook.timezone="UTC"'],
          priority: 'interactive',
        },
      );
      const hit = (res.value ?? []).find(
        (e) => e.transactionId === marker.graphTransactionId && e.isCancelled !== true,
      );
      if (hit !== undefined)
        return { kind: 'already_exists', providerId: hit.id, webLink: hit.webLink ?? null };
      url = res['@odata.nextLink'] ?? null;
    }
    return null;
  }
}
