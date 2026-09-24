/**
 * Demo `CalendarProvider` (INTEGRATION_PLAN §13.2–§13.3; TEST_PLAN EF-DEMO-02): the fixture calendars
 * and meetings of the local day, plus the events created and the changes made through approvals
 * (`private.demo_fixture_state`, resource `calendar`). A created event appears in its calendar on the
 * next sync and an updated event carries the approved times (M§100: no success without the change).
 *
 * The `demo_clock` cursor lists the whole current window (the dataset is small) and reports the
 * items of the days since the cursor that the current day no longer materialises as deleted, so the
 * account "keeps living day after day" without duplicate meetings.
 */
import {
  addDaysToLocalDate,
  type CalendarChangeSet,
  type CalendarCursor,
  type CalendarProvider,
  type CalendarWindow,
  type EventPatchSpec,
  type EventTime,
  type EventWriteSpec,
  type IdempotencyMarker,
  localDate,
  localDateDiffDays,
  type NormalizedCalendar,
  type NormalizedEvent,
  type ProviderContext,
  ProviderError,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { DEMO_SELF, demoDataset, type DemoFlavor } from './fixtures/index.ts';
import {
  type DemoAdapterDeps,
  type DemoEventUpdate,
  type DemoEventWrite,
  type DemoWrite,
  demoWrites,
  flavorOf,
  recordDemoWrite,
} from './writes.ts';

/** How many earlier local days a `demo_clock` round retires at most. */
const RETIRE_DAYS = 7;
const UPDATE_PREFIX = 'update:';

/** All-day events compare by their UTC midnight (the sync window is generous on both sides). */
function instantOf(t: EventTime): number {
  return 'date' in t ? Date.parse(`${t.date}T00:00:00Z`) : Date.parse(t.dateTime);
}

function inWindow(e: NormalizedEvent, window: CalendarWindow): boolean {
  const start = instantOf(e.start);
  const end = instantOf(e.end);
  return end > Date.parse(window.start) && start < Date.parse(window.end);
}

function createdEvent(write: DemoEventWrite, flavor: DemoFlavor): NormalizedEvent {
  const self = DEMO_SELF[flavor];
  return {
    providerEventId: write.id,
    providerCalendarId: write.calendarId,
    iCalUid: `${write.id}@demo.dijitalasistan.app`,
    seriesMasterId: null,
    originalStart: null,
    isOccurrence: false,
    status: 'confirmed',
    title: write.title,
    descriptionSnippet: write.description === null ? null : write.description.slice(0, 500),
    location: write.location,
    start: write.start,
    end: write.end,
    allDay: 'date' in write.start,
    organizer: { address: self.email, name: self.name },
    userIsOrganizer: true,
    attendees: [
      {
        email: self.email,
        name: self.name,
        responseStatus: 'accepted',
        isSelf: true,
        isOrganizer: true,
      },
      ...write.attendees.map((a) => ({
        email: a.address,
        name: a.name,
        responseStatus: 'needs_action' as const,
        isSelf: false,
        isOrganizer: false,
      })),
    ],
    conferenceUrl: null,
    transparency: 'busy',
    visibility: 'default',
    etag: `"demo-${write.id}"`,
    updatedAt: write.createdAt,
    daApprovalId: write.approvalId,
    deleted: false,
  };
}

function applyUpdate(e: NormalizedEvent, u: DemoEventUpdate, revision: number): NormalizedEvent {
  return {
    ...e,
    ...(u.start === undefined ? {} : { start: u.start, allDay: 'date' in u.start }),
    ...(u.end === undefined ? {} : { end: u.end }),
    ...(u.title === undefined ? {} : { title: u.title }),
    ...(u.location === undefined ? {} : { location: u.location }),
    etag: `"demo-${e.providerEventId}-${revision}"`,
    updatedAt: u.updatedAt,
    daApprovalId: u.approvalId,
  };
}

interface DemoCalendarState {
  readonly flavor: DemoFlavor;
  readonly timeZone: string;
  readonly anchor: string;
  readonly calendars: readonly NormalizedCalendar[];
  /** Current events (fixture of the day + created), updates applied. */
  readonly events: readonly NormalizedEvent[];
  readonly writes: Readonly<Record<string, DemoWrite>>;
}

export class DemoCalendarAdapter implements CalendarProvider {
  readonly provider = 'demo' as const;
  constructor(private readonly deps: DemoAdapterDeps) {}

  private async state(ctx: ProviderContext): Promise<DemoCalendarState> {
    const flavor = flavorOf(ctx);
    const timeZone = await this.deps.timeZone(ctx.account.userId);
    const now = ctx.clock.now();
    const dataset = demoDataset({ flavor, timeZone, now });
    const writes = await demoWrites(this.deps, ctx, 'calendar');
    const events = new Map<string, NormalizedEvent>(
      dataset.events.map((e) => [e.providerEventId, e]),
    );
    for (const w of Object.values(writes)) {
      if (w.kind === 'event_create') events.set(w.id, createdEvent(w, flavor));
    }
    const updates = Object.values(writes)
      .filter((w): w is DemoEventUpdate => w.kind === 'event_update')
      .sort(
        (a, b) =>
          a.updatedAt.localeCompare(b.updatedAt) || a.approvalId.localeCompare(b.approvalId),
      );
    const revisions = new Map<string, number>();
    for (const u of updates) {
      const current = events.get(u.eventId);
      if (current === undefined) continue;
      const revision = (revisions.get(u.eventId) ?? 0) + 1;
      revisions.set(u.eventId, revision);
      events.set(u.eventId, applyUpdate(current, u, revision));
    }
    return {
      flavor,
      timeZone,
      anchor: dataset.anchor,
      calendars: dataset.calendars,
      events: [...events.values()].sort(
        (a, b) =>
          instantOf(a.start) - instantOf(b.start) ||
          a.providerEventId.localeCompare(b.providerEventId),
      ),
      writes,
    };
  }

  private requireCalendar(state: DemoCalendarState, providerCalendarId: string): void {
    if (!state.calendars.some((c) => c.providerCalendarId === providerCalendarId)) {
      throw new ProviderError('not_found', 404, null, 'demo_calendar_missing');
    }
  }

  async listCalendars(ctx: ProviderContext): Promise<NormalizedCalendar[]> {
    return [...(await this.state(ctx)).calendars];
  }

  async getUserTimeZone(ctx: ProviderContext): Promise<string | null> {
    return await this.deps.timeZone(ctx.account.userId);
  }

  async fullSync(
    ctx: ProviderContext,
    providerCalendarId: string,
    window: CalendarWindow,
  ): Promise<CalendarChangeSet> {
    const state = await this.state(ctx);
    this.requireCalendar(state, providerCalendarId);
    const now = ctx.clock.now().toISOString();
    return {
      upserts: state.events.filter(
        (e) => e.providerCalendarId === providerCalendarId && inWindow(e, window),
      ),
      deleted: [],
      nextCursor: { kind: 'demo_clock', value: now, window },
      pageToken: null,
    };
  }

  async changesSince(
    ctx: ProviderContext,
    providerCalendarId: string,
    cursor: CalendarCursor,
  ): Promise<CalendarChangeSet> {
    if (cursor.kind !== 'demo_clock' || Number.isNaN(Date.parse(cursor.value))) {
      throw new ProviderError('cursor_invalid', 410, null, 'demo_cursor_invalid');
    }
    const state = await this.state(ctx);
    this.requireCalendar(state, providerCalendarId);
    const now = ctx.clock.now();
    const window = cursor.window ?? {
      start: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      end: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
    };
    const current = new Set(state.events.map((e) => e.providerEventId));
    const retired = new Set<string>();
    const lastDay = localDate(new Date(cursor.value), state.timeZone);
    const gap = Math.min(RETIRE_DAYS, Math.max(0, localDateDiffDays(lastDay, state.anchor)));
    for (let back = 1; back <= gap; back++) {
      const earlier = demoDataset({
        flavor: state.flavor,
        timeZone: state.timeZone,
        now,
        anchor: addDaysToLocalDate(state.anchor, -back),
      });
      for (const e of earlier.events) {
        if (e.providerCalendarId === providerCalendarId && !current.has(e.providerEventId))
          retired.add(e.providerEventId);
      }
    }
    await this.deps.store.demoSetClock(
      ctx.account.connectedAccountId,
      'calendar',
      now.toISOString(),
    );
    return {
      upserts: state.events.filter(
        (e) => e.providerCalendarId === providerCalendarId && inWindow(e, window),
      ),
      deleted: [...retired].sort(),
      nextCursor: { kind: 'demo_clock', value: now.toISOString(), window },
      pageToken: null,
    };
  }

  async expandSeries(
    ctx: ProviderContext,
    providerCalendarId: string,
    seriesMasterId: string,
    window: CalendarWindow,
  ): Promise<NormalizedEvent[]> {
    const state = await this.state(ctx);
    return state.events.filter(
      (e) =>
        e.providerCalendarId === providerCalendarId &&
        e.seriesMasterId === seriesMasterId &&
        inWindow(e, window),
    );
  }

  async getEvent(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
  ): Promise<NormalizedEvent | null> {
    const state = await this.state(ctx);
    return (
      state.events.find(
        (e) => e.providerCalendarId === providerCalendarId && e.providerEventId === providerEventId,
      ) ?? null
    );
  }

  async getEventDescription(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
    opts: { maxBytes: number },
  ): Promise<string | null> {
    const event = await this.getEvent(ctx, providerCalendarId, providerEventId);
    return event?.descriptionSnippet?.slice(0, opts.maxBytes) ?? null;
  }

  watch(): Promise<WatchHandle> {
    return Promise.reject(
      new ProviderError('external_credential_required', null, null, 'demo_polls'),
    );
  }

  renewWatch(): Promise<WatchHandle> {
    return this.watch();
  }

  stopWatch(): Promise<void> {
    return Promise.resolve();
  }

  async createEvent(ctx: ProviderContext, spec: EventWriteSpec): Promise<WriteOutcome> {
    const state = await this.state(ctx);
    this.requireCalendar(state, spec.providerCalendarId);
    const write: DemoEventWrite = {
      kind: 'event_create',
      id: `demo:event:${spec.marker.approvalId}`,
      approvalId: spec.marker.approvalId,
      calendarId: spec.providerCalendarId,
      title: spec.title.slice(0, 300),
      description: spec.description,
      location: spec.location,
      start: spec.start,
      end: spec.end,
      attendees: spec.attendees.map((a) => ({ address: a.address.toLowerCase(), name: a.name })),
      createdAt: ctx.clock.now().toISOString(),
    };
    const out = await recordDemoWrite(this.deps, ctx, 'calendar', spec.marker.approvalId, write);
    return out.created
      ? { kind: 'created', providerId: out.item.id, webLink: null }
      : { kind: 'already_exists', providerId: out.item.id, webLink: null };
  }

  async updateEvent(ctx: ProviderContext, patch: EventPatchSpec): Promise<WriteOutcome> {
    const state = await this.state(ctx);
    const key = `${UPDATE_PREFIX}${patch.marker.approvalId}`;
    const previous = state.writes[key];
    if (previous?.kind === 'event_update') return { kind: 'updated', providerId: previous.eventId };
    const event = state.events.find(
      (e) =>
        e.providerCalendarId === patch.providerCalendarId &&
        e.providerEventId === patch.providerEventId,
    );
    if (event === undefined) throw new ProviderError('not_found', 404, null, 'demo_event_missing');
    if (patch.expectedEtag !== null && patch.expectedEtag !== event.etag) {
      throw new ProviderError('precondition_failed', 412, null, 'demo_etag_mismatch');
    }
    const write: DemoEventUpdate = {
      kind: 'event_update',
      approvalId: patch.marker.approvalId,
      eventId: event.providerEventId,
      ...(patch.start === undefined ? {} : { start: patch.start }),
      ...(patch.end === undefined ? {} : { end: patch.end }),
      ...(patch.title === undefined ? {} : { title: patch.title.slice(0, 300) }),
      ...(patch.location === undefined ? {} : { location: patch.location }),
      updatedAt: ctx.clock.now().toISOString(),
    };
    const out = await recordDemoWrite(this.deps, ctx, 'calendar', key, write);
    return { kind: 'updated', providerId: out.item.eventId };
  }

  async findEventByMarker(
    ctx: ProviderContext,
    _providerCalendarId: string,
    marker: IdempotencyMarker,
  ): Promise<WriteOutcome | null> {
    const writes = await demoWrites(this.deps, ctx, 'calendar');
    const created = writes[marker.approvalId];
    if (created?.kind === 'event_create')
      return { kind: 'already_exists', providerId: created.id, webLink: null };
    const updated = writes[`${UPDATE_PREFIX}${marker.approvalId}`];
    if (updated?.kind === 'event_update') return { kind: 'updated', providerId: updated.eventId };
    return null;
  }
}
