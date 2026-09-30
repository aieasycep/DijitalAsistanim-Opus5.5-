/**
 * Planning slots (IMPLEMENTATION_PLAN T-5.14; AI_PIPELINE_PLAN §13.6; API-PLAN-01/02; M§19, M§20):
 * busy intervals from every selected calendar (non-cancelled, non-transparent) plus timed tasks,
 * the `@da/domain` slot finder over working hours (personal items: 09:00–21:00 every day) and
 * quiet hours, 10-minute buffers for focus blocks, and the deadline rule (a slot must end before
 * the item's due time). No model is involved.
 */
import {
  type BusyInterval,
  DEFAULT_QUIET_HOURS,
  findFreeSlots,
  PERSONAL_HOURS,
  type QuietHoursSpec,
  type Slot,
  type WorkingHours,
} from '@da/domain';
import type { AccountSource, QuietHours } from '../assist/store.ts';
import type { CalendarEventRow } from '../intel/types.ts';

/** A device calendar source is stale after 6 h without a snapshot (API-PLAN-01). */
export const DEVICE_STALE_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const DEVICE_PROVIDERS = new Set(['apple_device', 'android_device']);

export function busyIntervals(
  events: readonly CalendarEventRow[],
  tasks: readonly { start: string; end: string }[],
): BusyInterval[] {
  return [
    ...events.map((e) => ({
      start: e.start_at,
      end: e.end_at,
      cancelled: e.status === 'cancelled',
      allDay: e.all_day,
      declined: e.attendees.some((a) => a.self === true && a.response === 'declined'),
    })),
    ...tasks.map((t) => ({ start: t.start, end: t.end })),
  ];
}

export function quietSpec(quiet: QuietHours | null): QuietHoursSpec {
  return quiet === null
    ? DEFAULT_QUIET_HOURS
    : { enabled: quiet.enabled, start: quiet.start, end: quiet.end };
}

export function sourcesConsidered(accounts: readonly AccountSource[], now: Date) {
  return accounts
    .filter(
      (a) => a.capabilities_granted.includes('calendar_read') || DEVICE_PROVIDERS.has(a.provider),
    )
    .map((a) => ({
      account_id: a.id,
      provider: a.provider,
      last_sync_at: a.last_sync_at === null ? null : new Date(a.last_sync_at).toISOString(),
      stale:
        DEVICE_PROVIDERS.has(a.provider) &&
        (a.last_sync_at === null || now.getTime() - Date.parse(a.last_sync_at) > DEVICE_STALE_MS),
    }));
}

export interface SlotQuery {
  readonly from: Date;
  readonly to: Date;
  readonly minMinutes: number;
  readonly withinWorkingHours: boolean;
  readonly timeZone: string;
  readonly workingHours: WorkingHours;
  readonly quiet: QuietHoursSpec;
  readonly busy: readonly BusyInterval[];
  readonly bufferMinutes?: number;
  readonly before?: Date | null;
  readonly personal?: boolean;
}

/** Free windows of at least `minMinutes` inside [from, to), earliest first. */
export function freeSlots(q: SlotQuery): Slot[] {
  const hours =
    q.personal === true
      ? PERSONAL_HOURS
      : q.withinWorkingHours
        ? q.workingHours
        : { start: '00:00', end: '23:59', days: [1, 2, 3, 4, 5, 6, 7] };
  const end = q.before !== undefined && q.before !== null && q.before < q.to ? q.before : q.to;
  return findFreeSlots({
    now: q.from.getTime(),
    timeZone: q.timeZone,
    busy: q.busy,
    workingHours: hours,
    quietHours: q.withinWorkingHours || q.personal === true ? q.quiet : null,
    minMinutes: q.minMinutes,
    before: end.getTime(),
    horizonDays: Math.max(1, Math.ceil((end.getTime() - q.from.getTime()) / DAY_MS)),
    bufferMinutes: q.bufferMinutes ?? 0,
  }).filter((s) => s.start.getTime() >= q.from.getTime() && s.end.getTime() <= end.getTime());
}

/**
 * The proposal slot: the earliest window that fits the duration, preferring mornings or
 * afternoons when asked; up to three alternatives follow.
 */
export function pickSlot(
  slots: readonly Slot[],
  durationMinutes: number,
  prefer: 'morning' | 'afternoon' | 'any',
  timeZone: string,
): { slot: { start: Date; end: Date }; alternatives: { start: Date; end: Date }[] } | null {
  const hourOf = (d: Date) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(d),
    );
  const fits = slots
    .filter((s) => s.minutes >= durationMinutes)
    .map((s) => ({ start: s.start, end: new Date(s.start.getTime() + durationMinutes * 60_000) }));
  const preferred = fits.filter((s) =>
    prefer === 'morning'
      ? hourOf(s.start) < 12
      : prefer === 'afternoon'
        ? hourOf(s.start) >= 12
        : true,
  );
  const ordered = [...preferred, ...fits.filter((s) => !preferred.includes(s))];
  const first = ordered[0];
  if (first === undefined) return null;
  return { slot: first, alternatives: ordered.slice(1, 4) };
}
