/**
 * Calendar intelligence (M§20; AI_PIPELINE_PLAN §13.5; T0): conflicts, back-to-back meetings
 * (gap under 10 min), preparation need for meetings with external or VIP attendees, and the prep
 * slot. A location is used only when the event has one; travel or leave-by times are never
 * computed ("Seyahat süresi kaynakta yoksa uydurma.") — only a time stated in a verified source is
 * passed through.
 */
import { conflictPairKey } from '../ids.ts';
import { type Instant, localDate, toDate } from '../time/zone.ts';
import { type BusyInterval, firstFreeSlot, type Slot } from './slots.ts';

export interface IntelAttendee {
  readonly email: string;
  readonly self?: boolean;
  readonly contactId?: string | null;
  readonly response?: 'accepted' | 'declined' | 'tentative' | 'needs_action' | null;
}

export interface IntelEvent {
  readonly id: string;
  readonly start: Instant;
  readonly end: Instant;
  readonly allDay?: boolean;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
  /** "Free" / transparent events never conflict. */
  readonly transparent?: boolean;
  readonly attendees?: readonly IntelAttendee[];
  readonly organizerEmail?: string | null;
  readonly organizerSelf?: boolean;
  /** Organizer or `guestsCanModify` (moving it needs a `calendar_update` approval). */
  readonly canModify?: boolean;
  readonly location?: string | null;
  readonly isOnline?: boolean;
}

export interface IntelContext {
  readonly timeZone: string;
  /** The user's own mail domains; attendees outside them are external. */
  readonly ownDomains: readonly string[];
  readonly vipContactIds?: readonly string[];
  readonly vipEmails?: readonly string[];
  /** VIP effects need Pro (M§44). */
  readonly isPro?: boolean;
}

const MIN = 60_000;

function selfDeclined(e: IntelEvent): boolean {
  return (e.attendees ?? []).some((a) => a.self === true && a.response === 'declined');
}

/** Events that occupy time (non-cancelled, non-transparent, not declined, timed). */
export function isBlocking(e: IntelEvent): boolean {
  return e.status !== 'cancelled' && !e.transparent && !e.allDay && !selfDeclined(e);
}

/** Meetings: at least one other attendee or an online conference. */
export function isMeeting(e: IntelEvent): boolean {
  return (e.attendees ?? []).some((a) => a.self !== true) || e.isOnline === true;
}

export interface Conflict {
  readonly a: string;
  readonly b: string;
  readonly overlapMinutes: number;
  /** Stable pair key (event ids + start epochs) — "Böyle kalsın" suppression. */
  readonly suppressionKey: string;
  /** Which of the two the user may move (organizer / guestsCanModify). */
  readonly movable: readonly string[];
}

/** Every pair of blocking events that overlaps by more than 0 min. */
export function detectConflicts(events: readonly IntelEvent[]): Conflict[] {
  const list = events
    .filter(isBlocking)
    .sort((x, y) => toDate(x.start).getTime() - toDate(y.start).getTime());
  const out: Conflict[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a) continue;
    const aEnd = toDate(a.end).getTime();
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b) continue;
      const bStart = toDate(b.start).getTime();
      if (bStart >= aEnd) break;
      const overlap = Math.min(aEnd, toDate(b.end).getTime()) - bStart;
      if (overlap <= 0) continue;
      out.push({
        a: a.id,
        b: b.id,
        overlapMinutes: Math.round(overlap / MIN),
        suppressionKey: conflictPairKey(
          { id: a.id, startEpoch: toDate(a.start).getTime() / 1000 },
          { id: b.id, startEpoch: bStart / 1000 },
        ),
        movable: [a, b].filter((e) => e.canModify === true).map((e) => e.id),
      });
    }
  }
  return out;
}

export interface BackToBackRun {
  readonly localDate: string;
  readonly eventIds: readonly string[];
  /** Smallest gap inside the run, in minutes. */
  readonly minGapMinutes: number;
}

/** Runs of ≥2 consecutive meetings with gaps under `maxGapMinutes` (default 10). */
export function detectBackToBack(
  events: readonly IntelEvent[],
  timeZone: string,
  maxGapMinutes = 10,
): BackToBackRun[] {
  const meetings = events
    .filter((e) => isBlocking(e) && isMeeting(e))
    .sort((x, y) => toDate(x.start).getTime() - toDate(y.start).getTime());
  const runs: BackToBackRun[] = [];
  let run: IntelEvent[] = [];
  let runEnd = -Infinity;
  let minGap = Infinity;
  const flush = (): void => {
    const first = run[0];
    if (run.length >= 2 && first) {
      runs.push({
        localDate: localDate(first.start, timeZone),
        eventIds: run.map((e) => e.id),
        minGapMinutes: minGap,
      });
    }
    run = [];
    runEnd = -Infinity;
    minGap = Infinity;
  };
  for (const e of meetings) {
    const first = run[0];
    if (first) {
      // overlapping meetings (a conflict) also leave no gap
      const gap = (toDate(e.start).getTime() - runEnd) / MIN;
      if (
        gap < maxGapMinutes &&
        localDate(e.start, timeZone) === localDate(first.start, timeZone)
      ) {
        run.push(e);
        runEnd = Math.max(runEnd, toDate(e.end).getTime());
        minGap = Math.min(minGap, Math.max(0, gap));
        continue;
      }
      flush();
    }
    run.push(e);
    runEnd = toDate(e.end).getTime();
  }
  flush();
  return runs;
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

export type PrepReason = 'external_attendees' | 'vip_attendee';

export interface PrepNeed {
  readonly needed: boolean;
  readonly reasons: readonly PrepReason[];
  readonly externalAttendees: number;
}

/** Preparation need (R-23: precomputed at T-60 only for external or VIP meetings). */
export function prepNeed(event: IntelEvent, ctx: IntelContext): PrepNeed {
  const own = ctx.ownDomains.map((d) => d.toLowerCase());
  const others = (event.attendees ?? []).filter(
    (a) => a.self !== true && a.response !== 'declined',
  );
  const external = others.filter((a) => {
    const d = domainOf(a.email);
    return d !== '' && !own.some((o) => d === o || d.endsWith(`.${o}`));
  });
  const vipIds = ctx.vipContactIds ?? [];
  const vipEmails = (ctx.vipEmails ?? []).map((e) => e.toLowerCase());
  const vip =
    ctx.isPro === true &&
    others.some(
      (a) =>
        (typeof a.contactId === 'string' && vipIds.includes(a.contactId)) ||
        vipEmails.includes(a.email.toLowerCase()),
    );
  const reasons: PrepReason[] = [];
  if (external.length > 0) reasons.push('external_attendees');
  if (vip) reasons.push('vip_attendee');
  return {
    needed: reasons.length > 0 && isBlocking(event),
    reasons,
    externalAttendees: external.length,
  };
}

/**
 * "Hazırlığı Buraya Koy": a free slot of ≥30 min within the 3 h before a meeting that needs prep.
 */
export function findPrepSlot(
  event: IntelEvent,
  busy: readonly BusyInterval[],
  ctx: IntelContext & { readonly now: Instant },
  minMinutes = 30,
): Slot | null {
  if (!prepNeed(event, ctx).needed) return null;
  const start = toDate(event.start).getTime();
  const windowStart = Math.max(start - 3 * 3_600_000, toDate(ctx.now).getTime());
  return firstFreeSlot({
    now: windowStart,
    timeZone: ctx.timeZone,
    busy,
    before: start,
    minMinutes,
    horizonDays: 1,
    workingHours: { start: '00:00', end: '23:59', days: [1, 2, 3, 4, 5, 6, 7] },
    quietHours: null,
  });
}

export interface PlaceInfo {
  /** The event's own location text, when present; never inferred. */
  readonly location: string | null;
  readonly isOnline: boolean;
  /** A leave-by time only when a verified source states it; never computed. */
  readonly leaveBy: Date | null;
}

export function placeInfo(event: IntelEvent, statedLeaveBy?: Instant | null): PlaceInfo {
  const loc = event.location?.trim();
  return {
    location: loc !== undefined && loc.length > 0 ? loc : null,
    isOnline: event.isOnline === true,
    leaveBy: statedLeaveBy ? toDate(statedLeaveBy) : null,
  };
}

export interface DayIntel {
  readonly conflicts: readonly Conflict[];
  readonly backToBack: readonly BackToBackRun[];
  readonly prep: readonly { readonly eventId: string; readonly reasons: readonly PrepReason[] }[];
}

/** All calendar-intelligence signals for a set of events. */
export function analyzeCalendar(events: readonly IntelEvent[], ctx: IntelContext): DayIntel {
  return {
    conflicts: detectConflicts(events),
    backToBack: detectBackToBack(events, ctx.timeZone),
    prep: events
      .map((e) => ({ eventId: e.id, need: prepNeed(e, ctx) }))
      .filter((p) => p.need.needed)
      .map((p) => ({ eventId: p.eventId, reasons: p.need.reasons })),
  };
}
