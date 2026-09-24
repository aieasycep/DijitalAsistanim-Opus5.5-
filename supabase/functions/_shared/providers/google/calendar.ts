/**
 * Google Calendar `CalendarProvider` (INTEGRATION_PLAN §4.5, §3.12; API_CONTRACTS JOB-04, WH-02; T-4.05):
 * - calendar list with access role, primary flag and holiday / birthday detection;
 * - events with `singleEvents=true` (occurrences are rows) from `timeMin` of the rolling window;
 *   incremental with the per-calendar `nextSyncToken` (only on the last page); 410 →
 *   `cursor_invalid` (bounded full resync);
 * - the full description is reduced to a ≤500-char excerpt in memory; the conference URL is kept only
 *   for allow-listed hosts; `extendedProperties.private.da_approval_id` is carried for
 *   reconciliation;
 * - `events.watch` channels with token `base64url(HMAC-SHA256(WEBHOOK_HMAC_SECRET, channel id))`,
 *   `channels.stop` for the old channel on renewal;
 * - writes: insert with the deterministic event id (409 → `already_exists` after `events.get`),
 *   patch with `If-Match` (412 → `precondition_failed`), `da_last_approval_id` marker.
 */
import {
  type CalendarChangeSet,
  type CalendarCursor,
  type CalendarProvider,
  type CalendarWindow,
  checkConferencingUrl,
  type EventPatchSpec,
  type EventTime,
  type EventWriteSpec,
  type IdempotencyMarker,
  type NormalizedCalendar,
  type NormalizedEvent,
  type ProviderContext,
  ProviderError,
  type QuotaPriority,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { hmacSha256Base64Url, sha256Hex } from '../../crypto/hmac.ts';
import {
  type AdapterHttp,
  authorizedJson,
  excerpt,
  excerptOrNull,
  isoOrNull,
  jsonBody,
} from '../common.ts';
import type { GoogleEndpoints } from './config.ts';

export interface GoogleCalendarConfig {
  readonly endpoints: GoogleEndpoints;
  readonly http: AdapterHttp;
  /** `GOOGLE_CALENDAR_WEBHOOK_URL` + `WEBHOOK_HMAC_SECRET`; null → no channels (polling only). */
  readonly webhook: { readonly address: string; readonly hmacSecret: string } | null;
  readonly newId?: () => string;
}

interface GTime {
  readonly dateTime?: string;
  readonly date?: string;
  readonly timeZone?: string;
}

interface GEvent {
  readonly id: string;
  readonly status?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly location?: string;
  readonly start?: GTime;
  readonly end?: GTime;
  readonly originalStartTime?: GTime;
  readonly recurringEventId?: string;
  readonly iCalUID?: string;
  readonly etag?: string;
  readonly updated?: string;
  readonly transparency?: string;
  readonly visibility?: string;
  readonly hangoutLink?: string;
  readonly htmlLink?: string;
  readonly conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  readonly organizer?: { email?: string; displayName?: string; self?: boolean };
  readonly attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }[];
  readonly extendedProperties?: { private?: Record<string, string> };
}

interface GCalendarListEntry {
  readonly id: string;
  readonly summary?: string;
  readonly summaryOverride?: string;
  readonly backgroundColor?: string;
  readonly timeZone?: string;
  readonly accessRole?: string;
  readonly primary?: boolean;
  readonly deleted?: boolean;
}

const EVENT_FIELDS =
  'items(id,status,summary,description,location,start,end,attendees(email,displayName,responseStatus,self,organizer),' +
  'organizer,recurringEventId,originalStartTime,hangoutLink,conferenceData/entryPoints,updated,iCalUID,etag,' +
  'transparency,visibility,eventType,extendedProperties/private),nextPageToken,nextSyncToken';

function eventTime(time: GTime | undefined): EventTime | null {
  if (time?.date !== undefined) return { date: time.date };
  const iso = isoOrNull(time?.dateTime ?? null);
  return iso === null ? null : { dateTime: iso, timeZone: time?.timeZone ?? null };
}

function conferenceUrl(event: GEvent): string | null {
  const candidates = [
    event.hangoutLink,
    ...(event.conferenceData?.entryPoints ?? [])
      .filter((e) => e.entryPointType === 'video')
      .map((e) => e.uri),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const check = checkConferencingUrl(candidate);
    if (check.ok) return check.url;
  }
  return null;
}

const RESPONSE: Readonly<Record<string, NormalizedEvent['attendees'][number]['responseStatus']>> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
  needsAction: 'needs_action',
};

/** Google event → normalised event (description only as a ≤500-char excerpt). */
export function normalizeGoogleEvent(event: GEvent, providerCalendarId: string): NormalizedEvent {
  const cancelled = event.status === 'cancelled';
  const start = eventTime(event.start) ??
    eventTime(event.originalStartTime) ?? { date: '1970-01-01' };
  const end = eventTime(event.end) ?? start;
  const visibility = event.visibility;
  return {
    providerEventId: event.id,
    providerCalendarId,
    iCalUid: event.iCalUID ?? null,
    seriesMasterId: event.recurringEventId ?? null,
    originalStart: eventTime(event.originalStartTime),
    isOccurrence: event.recurringEventId !== undefined,
    status: cancelled ? 'cancelled' : event.status === 'tentative' ? 'tentative' : 'confirmed',
    title: excerpt(event.summary ?? '', 300),
    descriptionSnippet: excerptOrNull(event.description, 500),
    location: excerptOrNull(event.location, 300),
    start,
    end,
    allDay: 'date' in start,
    organizer:
      event.organizer?.email === undefined
        ? null
        : {
            address: event.organizer.email.toLowerCase(),
            name: event.organizer.displayName ?? null,
          },
    userIsOrganizer: event.organizer?.self === true,
    attendees: (event.attendees ?? [])
      .filter((a) => typeof a.email === 'string')
      .slice(0, 100)
      .map((a) => ({
        email: (a.email ?? '').toLowerCase(),
        name: a.displayName ?? null,
        responseStatus: RESPONSE[a.responseStatus ?? ''] ?? null,
        isSelf: a.self === true,
        isOrganizer: a.organizer === true,
      })),
    conferenceUrl: conferenceUrl(event),
    transparency: event.transparency === 'transparent' ? 'free' : 'busy',
    visibility:
      visibility === 'public' || visibility === 'private' || visibility === 'confidential'
        ? visibility
        : 'default',
    etag: event.etag ?? null,
    updatedAt: isoOrNull(event.updated ?? null),
    daApprovalId: event.extendedProperties?.private?.da_approval_id ?? null,
    deleted: cancelled,
  };
}

function calendarKind(entry: GCalendarListEntry): NormalizedCalendar['kind'] {
  if (entry.id.endsWith('#holiday@group.v.calendar.google.com')) return 'holidays';
  if (entry.id.endsWith('#contacts@group.v.calendar.google.com')) return 'birthdays';
  if (entry.primary === true) return 'default';
  return entry.accessRole === 'owner' || entry.accessRole === 'writer' ? 'other' : 'shared';
}

function accessRole(role: string | undefined): NormalizedCalendar['accessRole'] {
  if (role === 'owner' || role === 'writer' || role === 'reader') return role;
  return 'free_busy_reader';
}

function toGoogleTime(time: EventTime): GTime {
  return 'date' in time
    ? { date: time.date }
    : { dateTime: time.dateTime, ...(time.timeZone ? { timeZone: time.timeZone } : {}) };
}

export class GoogleCalendarAdapter implements CalendarProvider {
  readonly provider = 'google' as const;
  constructor(private readonly config: GoogleCalendarConfig) {}

  private url(path: string, query: Record<string, string | null | undefined> = {}): string {
    const url = new URL(`${this.config.endpoints.calendar}/calendar/v3${path}`);
    for (const [key, value] of Object.entries(query))
      if (value !== null && value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }

  private cal(id: string): string {
    return `/calendars/${encodeURIComponent(id)}`;
  }

  private request<T>(
    ctx: ProviderContext,
    url: string,
    init: {
      method?: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      headers?: Record<string, string>;
      priority?: QuotaPriority;
    } = {},
  ): Promise<T> {
    const payload = init.body === undefined ? null : jsonBody(init.body);
    return authorizedJson<T>(ctx, this.config.http, {
      url,
      method: init.method ?? 'GET',
      ...(payload === null ? {} : { body: payload.body }),
      headers: { ...(payload?.headers ?? {}), ...(init.headers ?? {}) },
      quota: { bucket: 'gcal_user_requests', units: 1, priority: init.priority ?? 'sync' },
    });
  }

  async listCalendars(ctx: ProviderContext): Promise<NormalizedCalendar[]> {
    const out: NormalizedCalendar[] = [];
    let pageToken: string | null = null;
    do {
      const res: { items?: GCalendarListEntry[]; nextPageToken?: string } = await this.request(
        ctx,
        this.url('/users/me/calendarList', { maxResults: '250', pageToken }),
      );
      for (const entry of res.items ?? []) {
        const role = accessRole(entry.accessRole);
        out.push({
          providerCalendarId: entry.id,
          name: (entry.summaryOverride ?? entry.summary ?? entry.id).slice(0, 200),
          color: /^#[0-9a-f]{6}$/i.test(entry.backgroundColor ?? '')
            ? (entry.backgroundColor ?? null)
            : null,
          timeZone: entry.timeZone ?? null,
          accessRole: role,
          isPrimary: entry.primary === true,
          canWrite: role === 'owner',
          kind: calendarKind(entry),
          deleted: entry.deleted === true,
        });
      }
      pageToken = res.nextPageToken ?? null;
    } while (pageToken !== null);
    return out;
  }

  async getUserTimeZone(ctx: ProviderContext): Promise<string | null> {
    const res = await this.request<{ value?: string }>(
      ctx,
      this.url('/users/me/settings/timezone'),
    );
    return res.value ?? null;
  }

  private async page(
    ctx: ProviderContext,
    providerCalendarId: string,
    query: Record<string, string | null>,
    window: CalendarWindow | undefined,
  ): Promise<CalendarChangeSet> {
    let res: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      res = await this.request(
        ctx,
        this.url(`${this.cal(providerCalendarId)}/events`, {
          ...query,
          singleEvents: 'true',
          maxResults: '250',
          fields: EVENT_FIELDS,
        }),
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.httpStatus === 410 || error.code === 'cursor_invalid')
      ) {
        throw new ProviderError('cursor_invalid', 410, null, 'full_sync_required');
      }
      throw error;
    }
    const upserts: NormalizedEvent[] = [];
    const deleted: string[] = [];
    for (const item of res.items ?? []) {
      if (item.status === 'cancelled' && item.start === undefined) {
        deleted.push(item.id);
        continue;
      }
      upserts.push(normalizeGoogleEvent(item, providerCalendarId));
    }
    return {
      upserts,
      deleted,
      nextCursor:
        res.nextSyncToken === undefined
          ? null
          : {
              kind: 'gcal_sync_token',
              value: res.nextSyncToken,
              ...(window === undefined ? {} : { window }),
            },
      pageToken: res.nextPageToken ?? null,
    };
  }

  async fullSync(
    ctx: ProviderContext,
    providerCalendarId: string,
    window: CalendarWindow,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet> {
    return await this.page(
      ctx,
      providerCalendarId,
      { timeMin: window.start, pageToken: pageToken ?? null },
      window,
    );
  }

  async changesSince(
    ctx: ProviderContext,
    providerCalendarId: string,
    cursor: CalendarCursor,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet> {
    return await this.page(
      ctx,
      providerCalendarId,
      { syncToken: cursor.value, pageToken: pageToken ?? null },
      cursor.window,
    );
  }

  async expandSeries(
    ctx: ProviderContext,
    providerCalendarId: string,
    seriesMasterId: string,
    window: CalendarWindow,
  ): Promise<NormalizedEvent[]> {
    const res = await this.request<{ items?: GEvent[] }>(
      ctx,
      this.url(
        `${this.cal(providerCalendarId)}/events/${encodeURIComponent(seriesMasterId)}/instances`,
        {
          timeMin: window.start,
          timeMax: window.end,
          maxResults: '250',
        },
      ),
    );
    return (res.items ?? []).map((item) => normalizeGoogleEvent(item, providerCalendarId));
  }

  private async fetchEvent(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
  ): Promise<GEvent | null> {
    try {
      return await this.request<GEvent>(
        ctx,
        this.url(`${this.cal(providerCalendarId)}/events/${encodeURIComponent(providerEventId)}`),
        { priority: 'interactive' },
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.code === 'not_found' || error.httpStatus === 410)
      )
        return null;
      throw error;
    }
  }

  async getEvent(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
  ): Promise<NormalizedEvent | null> {
    const event = await this.fetchEvent(ctx, providerCalendarId, providerEventId);
    return event === null ? null : normalizeGoogleEvent(event, providerCalendarId);
  }

  async getEventDescription(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
    opts: { maxBytes: number },
  ): Promise<string | null> {
    const event = await this.fetchEvent(ctx, providerCalendarId, providerEventId);
    return event?.description === undefined ? null : excerpt(event.description, opts.maxBytes);
  }

  async watch(ctx: ProviderContext, providerCalendarId: string): Promise<WatchHandle> {
    if (this.config.webhook === null) {
      throw new ProviderError(
        'external_credential_required',
        null,
        null,
        'calendar_webhook_not_configured',
      );
    }
    const channelId = (this.config.newId ?? (() => crypto.randomUUID()))();
    const token = await hmacSha256Base64Url(this.config.webhook.hmacSecret, channelId);
    const res = await this.request<{ id: string; resourceId?: string; expiration?: string }>(
      ctx,
      this.url(`${this.cal(providerCalendarId)}/events/watch`),
      {
        method: 'POST',
        body: {
          id: channelId,
          type: 'web_hook',
          address: this.config.webhook.address,
          token,
          params: { ttl: '604800' },
        },
        priority: 'interactive',
      },
    );
    return {
      resource: 'google_calendar',
      resourceKey: providerCalendarId,
      watchId: res.id ?? channelId,
      providerResourceId: res.resourceId ?? null,
      expiresAt:
        isoOrNull(res.expiration === undefined ? null : Number(res.expiration)) ??
        new Date(ctx.clock.now().getTime() + 7 * 86_400_000).toISOString(),
      tokenHash: await sha256Hex(token),
    };
  }

  /** Renewal creates the new channel first, then stops the old one (§4.5). */
  async renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle> {
    const next = await this.watch(ctx, handle.resourceKey);
    await this.stopWatch(ctx, handle).catch(() => undefined);
    return next;
  }

  async stopWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    try {
      await this.request(ctx, this.url('/channels/stop'), {
        method: 'POST',
        body: { id: handle.watchId, resourceId: handle.providerResourceId },
        priority: 'interactive',
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') return;
      throw error;
    }
  }

  async createEvent(ctx: ProviderContext, spec: EventWriteSpec): Promise<WriteOutcome> {
    const sendUpdates = spec.attendees.length > 0 ? spec.sendUpdates : 'none';
    try {
      const created = await this.request<{ id: string; htmlLink?: string }>(
        ctx,
        this.url(`${this.cal(spec.providerCalendarId)}/events`, { sendUpdates }),
        {
          method: 'POST',
          priority: 'interactive',
          body: {
            id: spec.marker.googleEventId,
            summary: spec.title,
            ...(spec.description === null ? {} : { description: spec.description }),
            ...(spec.location === null ? {} : { location: spec.location }),
            start: toGoogleTime(spec.start),
            end: toGoogleTime(spec.end),
            attendees: spec.attendees.map((a) => ({
              email: a.address,
              ...(a.name ? { displayName: a.name } : {}),
            })),
            reminders: {
              useDefault: spec.reminderMinutes.length === 0,
              ...(spec.reminderMinutes.length === 0
                ? {}
                : {
                    overrides: spec.reminderMinutes
                      .slice(0, 5)
                      .map((minutes) => ({ method: 'popup', minutes })),
                  }),
            },
            extendedProperties: { private: { da_approval_id: spec.marker.approvalId } },
          },
        },
      );
      return { kind: 'created', providerId: created.id, webLink: created.htmlLink ?? null };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'conflict_exists') {
        const existing = await this.fetchEvent(
          ctx,
          spec.providerCalendarId,
          spec.marker.googleEventId,
        );
        if (existing !== null) {
          return {
            kind: 'already_exists',
            providerId: existing.id,
            webLink: existing.htmlLink ?? null,
          };
        }
      }
      throw error;
    }
  }

  async updateEvent(ctx: ProviderContext, patch: EventPatchSpec): Promise<WriteOutcome> {
    const body: Record<string, unknown> = {
      extendedProperties: { private: { da_last_approval_id: patch.marker.approvalId } },
    };
    if (patch.start !== undefined) body.start = toGoogleTime(patch.start);
    if (patch.end !== undefined) body.end = toGoogleTime(patch.end);
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.location !== undefined) body.location = patch.location ?? '';
    try {
      const updated = await this.request<{ id: string }>(
        ctx,
        this.url(
          `${this.cal(patch.providerCalendarId)}/events/${encodeURIComponent(patch.providerEventId)}`,
          {
            sendUpdates: patch.sendUpdates,
          },
        ),
        {
          method: 'PATCH',
          priority: 'interactive',
          body,
          ...(patch.expectedEtag === null ? {} : { headers: { 'If-Match': patch.expectedEtag } }),
        },
      );
      return { kind: 'updated', providerId: updated.id };
    } catch (error) {
      if (error instanceof ProviderError && error.providerReason === 'forbiddenForNonOrganizer') {
        throw new ProviderError(
          'not_organizer',
          error.httpStatus,
          null,
          'forbiddenForNonOrganizer',
        );
      }
      throw error;
    }
  }

  async findEventByMarker(
    ctx: ProviderContext,
    providerCalendarId: string,
    marker: IdempotencyMarker,
    around: CalendarWindow,
  ): Promise<WriteOutcome | null> {
    const direct = await this.fetchEvent(ctx, providerCalendarId, marker.googleEventId);
    if (direct !== null && direct.status !== 'cancelled') {
      return { kind: 'already_exists', providerId: direct.id, webLink: direct.htmlLink ?? null };
    }
    const res = await this.request<{ items?: GEvent[] }>(
      ctx,
      this.url(`${this.cal(providerCalendarId)}/events`, {
        privateExtendedProperty: `da_last_approval_id=${marker.approvalId}`,
        timeMin: around.start,
        timeMax: around.end,
        singleEvents: 'true',
        maxResults: '5',
      }),
      { priority: 'interactive' },
    );
    const updated = (res.items ?? []).find((e) => e.status !== 'cancelled');
    return updated === undefined
      ? null
      : { kind: 'already_exists', providerId: updated.id, webLink: updated.htmlLink ?? null };
  }
}
