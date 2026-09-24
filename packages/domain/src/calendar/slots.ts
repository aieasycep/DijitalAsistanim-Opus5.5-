/**
 * Deterministic free-slot finder (T0; AI_PIPELINE_PLAN §13.6; API-PLAN-01; "Uygun zamanda").
 * Busy intervals come from every selected calendar (non-declined, non-transparent, non-cancelled);
 * all-day out-of-office events block the day. Slots stay inside working hours on working days,
 * before the due time, and never inside quiet hours. Buffers pad busy intervals.
 */
import {
  addDaysToLocalDate,
  atLocalTime,
  type Instant,
  isoWeekdayOf,
  localDate,
  type LocalTimeString,
  nextQuietWindow,
  quietWindowContaining,
  toDate,
} from '../time/zone.ts';

export interface BusyInterval {
  readonly start: Instant;
  readonly end: Instant;
  readonly transparent?: boolean;
  readonly declined?: boolean;
  readonly cancelled?: boolean;
  readonly allDay?: boolean;
  /** An all-day out-of-office event blocks the whole local day. */
  readonly outOfOffice?: boolean;
}

export interface WorkingHours {
  readonly start: LocalTimeString;
  readonly end: LocalTimeString;
  /** ISO weekdays (default Mon–Fri). */
  readonly days: readonly number[];
}

export interface QuietHoursSpec {
  readonly enabled: boolean;
  readonly start: LocalTimeString;
  readonly end: LocalTimeString;
  readonly days?: readonly number[];
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: '09:00',
  end: '18:00',
  days: [1, 2, 3, 4, 5],
};
/** Personal items use 09:00–21:00 every day (§13.6). */
export const PERSONAL_HOURS: WorkingHours = {
  start: '09:00',
  end: '21:00',
  days: [1, 2, 3, 4, 5, 6, 7],
};
export const DEFAULT_QUIET_HOURS: QuietHoursSpec = { enabled: true, start: '22:30', end: '07:30' };

export interface SlotFinderInput {
  readonly now: Instant;
  readonly timeZone: string;
  readonly busy: readonly BusyInterval[];
  readonly workingHours?: WorkingHours;
  readonly quietHours?: QuietHoursSpec | null;
  /** Minimum free minutes (reminders 15; focus blocks the task estimate). */
  readonly minMinutes?: number;
  /** The slot must end at or before this instant (the due time). */
  readonly before?: Instant | null;
  /** Search horizon in days (default 14). */
  readonly horizonDays?: number;
  /** Padding around busy intervals (focus blocks 10; reminders 0). */
  readonly bufferMinutes?: number;
  /** Slot starts are rounded up to this grid (default 5 min). */
  readonly roundToMinutes?: number;
}

export interface Slot {
  readonly start: Date;
  readonly end: Date;
  readonly minutes: number;
}

type Range = [number, number];

function subtract(ranges: Range[], cut: Range): Range[] {
  const out: Range[] = [];
  for (const [s, e] of ranges) {
    if (cut[1] <= s || cut[0] >= e) {
      out.push([s, e]);
      continue;
    }
    if (cut[0] > s) out.push([s, cut[0]]);
    if (cut[1] < e) out.push([cut[1], e]);
  }
  return out;
}

const MIN = 60_000;

/** All free windows of at least `minMinutes`, earliest first. */
export function findFreeSlots(input: SlotFinderInput): Slot[] {
  const tz = input.timeZone;
  const now = toDate(input.now).getTime();
  const wh = input.workingHours ?? DEFAULT_WORKING_HOURS;
  const quiet = input.quietHours === undefined ? DEFAULT_QUIET_HOURS : input.quietHours;
  const minMs = Math.max(1, input.minMinutes ?? 15) * MIN;
  const buffer = (input.bufferMinutes ?? 0) * MIN;
  const grid = (input.roundToMinutes ?? 5) * MIN;
  const before = input.before ? toDate(input.before).getTime() : Infinity;
  const horizon = input.horizonDays ?? 14;
  const today = localDate(now, tz);

  const busy = input.busy.filter((b) => !b.transparent && !b.declined && !b.cancelled);
  const oooDays = new Set(
    busy
      .filter((b) => b.allDay && b.outOfOffice)
      .flatMap((b) => {
        const days: string[] = [];
        let d = localDate(b.start, tz);
        const last = localDate(new Date(toDate(b.end).getTime() - 1), tz);
        for (let i = 0; i < 400 && d <= last; i++) {
          days.push(d);
          d = addDaysToLocalDate(d, 1);
        }
        return days;
      }),
  );
  const timed = busy.filter((b) => !b.allDay);

  const slots: Slot[] = [];
  for (let k = 0; k <= horizon; k++) {
    const day = addDaysToLocalDate(today, k);
    if (!wh.days.includes(isoWeekdayOf(day)) || oooDays.has(day)) continue;
    let from = atLocalTime(day, wh.start, tz).getTime();
    const to = Math.min(atLocalTime(day, wh.end, tz).getTime(), before);
    if (from >= before) break;
    from = Math.max(from, now);
    from = Math.ceil(from / grid) * grid;
    if (to - from < minMs) continue;
    let free: Range[] = [[from, to]];
    for (const b of timed) {
      free = subtract(free, [toDate(b.start).getTime() - buffer, toDate(b.end).getTime() + buffer]);
    }
    if (quiet?.enabled) {
      const spec = quiet.days
        ? { start: quiet.start, end: quiet.end, days: quiet.days }
        : { start: quiet.start, end: quiet.end };
      // the window containing the start of the working window, then every later one before `to`
      const first = quietWindowContaining(spec, from, tz);
      if (first) free = subtract(free, [first.start.getTime(), first.end.getTime()]);
      let cursor = from;
      for (let i = 0; i < 4; i++) {
        const w = nextQuietWindow(spec, cursor, tz);
        if (!w || w.start.getTime() >= to) break;
        free = subtract(free, [w.start.getTime(), w.end.getTime()]);
        cursor = w.start.getTime();
      }
    }
    for (const [s0, e] of free) {
      const s = Math.ceil(s0 / grid) * grid;
      if (e - s >= minMs)
        slots.push({ start: new Date(s), end: new Date(e), minutes: Math.floor((e - s) / MIN) });
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The earliest slot, or `null` (the UI then offers "Kendin seç"). */
export function firstFreeSlot(input: SlotFinderInput): Slot | null {
  return findFreeSlots(input)[0] ?? null;
}
