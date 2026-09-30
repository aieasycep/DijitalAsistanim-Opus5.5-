/**
 * Time-zone helpers. Instants are UTC (`Date`); user-facing wall-clock logic always runs in the
 * user's IANA zone (`user_preferences.timezone`, default Europe/Istanbul). All functions are pure:
 * the current time is always passed in (TEST_PLAN §12.4, "two clocks").
 *
 * DST rules (UT-TZ-04/05, matching Postgres): a wall-clock time inside a spring-forward gap is
 * shifted forward by the gap; an ambiguous fall-back time resolves to its earliest occurrence.
 */
import { tzOffset } from '@date-fns/tz';

/** Anything that denotes an instant. Strings must be ISO 8601 with an offset or `Z`. */
export type Instant = Date | string | number;

/** A local calendar date `yyyy-MM-dd`. */
export type LocalDateString = string;
/** A local wall-clock time `HH:mm`. */
export type LocalTimeString = string;

export const DEFAULT_TIME_ZONE = 'Europe/Istanbul';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;

/** Converts an {@link Instant} to a `Date`, throwing a `RangeError` for invalid input. */
export function toDate(value: Instant): Date {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid instant: ${String(value)}`);
  return d;
}

const validZones = new Map<string, boolean>();

/** True for IANA zone names accepted by the runtime's Intl implementation. */
export function isValidTimeZone(timeZone: string): boolean {
  const cached = validZones.get(timeZone);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    ok = timeZone.length > 0;
  } catch {
    ok = false;
  }
  validZones.set(timeZone, ok);
  return ok;
}

function assertZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`invalid time zone: ${timeZone}`);
}

/** UTC offset of `timeZone` at `instant`, in minutes (Istanbul → 180). */
export function tzOffsetMinutes(timeZone: string, instant: Instant): number {
  assertZone(timeZone);
  return tzOffset(timeZone, toDate(instant));
}

export interface LocalParts {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  readonly isoWeekday: number;
  readonly offsetMinutes: number;
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function localParts(instant: Instant, timeZone: string): LocalParts {
  const d = toDate(instant);
  const offsetMinutes = tzOffsetMinutes(timeZone, d);
  const shifted = new Date(d.getTime() + offsetMinutes * MINUTE);
  const dow = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    isoWeekday: dow === 0 ? 7 : dow,
    offsetMinutes,
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Formats y/m/d as `yyyy-MM-dd`. */
export function formatLocalDate(year: number, month: number, day: number): LocalDateString {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Local calendar date of `instant` in `timeZone` (`yyyy-MM-dd`). */
export function localDate(instant: Instant, timeZone: string): LocalDateString {
  const p = localParts(instant, timeZone);
  return formatLocalDate(p.year, p.month, p.day);
}

/** Local wall-clock time of `instant` in `timeZone` (`HH:mm`, 24-hour). */
export function localTime(instant: Instant, timeZone: string): LocalTimeString {
  const p = localParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export interface YMD {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Parses `yyyy-MM-dd`, validating the calendar date. */
export function parseLocalDate(s: LocalDateString): YMD {
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) throw new RangeError(`invalid local date: ${s}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`invalid local date: ${s}`);
  }
  return { year, month, day };
}

export function isLocalDateString(s: string): boolean {
  try {
    parseLocalDate(s);
    return true;
  } catch {
    return false;
  }
}

/** Parses `HH:mm` (or Postgres `HH:mm:ss`) into hour/minute. */
export function parseHHmm(s: LocalTimeString): { hour: number; minute: number } {
  const m = HHMM_RE.exec(s);
  if (!m) throw new RangeError(`invalid local time: ${s}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Minutes since local midnight for `HH:mm`. */
export function minutesOfDay(s: LocalTimeString): number {
  const { hour, minute } = parseHHmm(s);
  return hour * 60 + minute;
}

/** Formats minutes since midnight as `HH:mm` (wraps at 24 h). */
export function hhmmFromMinutes(total: number): LocalTimeString {
  const m = ((Math.trunc(total) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Adds `days` calendar days to a local date. */
export function addDaysToLocalDate(date: LocalDateString, days: number): LocalDateString {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole calendar days from `a` to `b` (b − a). */
export function localDateDiffDays(a: LocalDateString, b: LocalDateString): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS,
  );
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a local date. */
export function isoWeekdayOf(date: LocalDateString): number {
  const { year, month, day } = parseLocalDate(date);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Last calendar day of the month containing `date`. */
export function endOfMonthLocalDate(date: LocalDateString): LocalDateString {
  const { year, month } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month, 0));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: LocalDateString): LocalDateString {
  return addDaysToLocalDate(date, 1 - isoWeekdayOf(date));
}

/**
 * The UTC instant of a wall-clock time in `timeZone`. DST gap → shifted forward by the gap;
 * DST overlap → the earliest occurrence.
 */
export function zonedWallTimeToInstant(
  date: LocalDateString,
  time: LocalTimeString,
  timeZone: string,
): Date {
  assertZone(timeZone);
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseHHmm(time);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const before = tzOffset(timeZone, new Date(naive - 14 * HOUR));
  const after = tzOffset(timeZone, new Date(naive + 14 * HOUR));
  const valid: number[] = [];
  for (const offset of new Set([before, after])) {
    const utc = naive - offset * MINUTE;
    if (tzOffset(timeZone, new Date(utc)) === offset) valid.push(utc);
  }
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Gap: interpret with the pre-transition offset, which lands after the gap.
  return new Date(naive - before * MINUTE);
}

/**
 * `atLocalTime(date, 'HH:mm', tz)`: the instant at a local wall-clock time on a local date. `date`
 * may be a `yyyy-MM-dd` local date or an instant (its local date in `tz` is used).
 */
export function atLocalTime(
  date: LocalDateString | Instant,
  time: LocalTimeString,
  timeZone: string,
): Date {
  const day =
    typeof date === 'string' && LOCAL_DATE_RE.test(date) ? date : localDate(date, timeZone);
  return zonedWallTimeToInstant(day, time, timeZone);
}

/** Start of the local day (00:00, gap-safe) as an instant. */
export function startOfLocalDay(date: LocalDateString, timeZone: string): Date {
  return zonedWallTimeToInstant(date, '00:00', timeZone);
}

/** Start of the next local day (exclusive end of `date`). */
export function endOfLocalDay(date: LocalDateString, timeZone: string): Date {
  return startOfLocalDay(addDaysToLocalDate(date, 1), timeZone);
}

/** Adds minutes to an instant. */
export function addMinutes(instant: Instant, minutes: number): Date {
  return new Date(toDate(instant).getTime() + minutes * MINUTE);
}

/** Minutes between two instants (b − a), rounded towards zero. */
export function diffMinutes(a: Instant, b: Instant): number {
  return Math.trunc((toDate(b).getTime() - toDate(a).getTime()) / MINUTE);
}

export interface QuietWindowSpec {
  /** `HH:mm` local start (default 22:30, R-13). */
  readonly start: LocalTimeString;
  /** `HH:mm` local end (default 07:30, R-13). */
  readonly end: LocalTimeString;
  /** ISO weekdays on which a window may start (default every day). */
  readonly days?: readonly number[];
}

export interface ConcreteWindow {
  readonly start: Date;
  readonly end: Date;
  /** Local date on which the window started. */
  readonly startLocalDate: LocalDateString;
}

function windowStartingOn(
  date: LocalDateString,
  spec: QuietWindowSpec,
  timeZone: string,
): ConcreteWindow | null {
  const s = minutesOfDay(spec.start);
  const e = minutesOfDay(spec.end);
  if (s === e) return null;
  if (spec.days && !spec.days.includes(isoWeekdayOf(date))) return null;
  const endDate = s < e ? date : addDaysToLocalDate(date, 1);
  return {
    start: zonedWallTimeToInstant(date, spec.start, timeZone),
    end: zonedWallTimeToInstant(endDate, spec.end, timeZone),
    startLocalDate: date,
  };
}

/**
 * The concrete quiet window (UTC instants) that contains `now`, or `null`. Windows may cross
 * midnight; their length in UTC follows DST (UT-TZ-08).
 */
export function quietWindowContaining(
  spec: QuietWindowSpec,
  now: Instant,
  timeZone: string,
): ConcreteWindow | null {
  const t = toDate(now).getTime();
  const today = localDate(now, timeZone);
  for (const d of [addDaysToLocalDate(today, -1), today]) {
    const w = windowStartingOn(d, spec, timeZone);
    if (w && t >= w.start.getTime() && t < w.end.getTime()) return w;
  }
  return null;
}

/** The next quiet window starting strictly after `now` (within 8 days), or `null`. */
export function nextQuietWindow(
  spec: QuietWindowSpec,
  now: Instant,
  timeZone: string,
): ConcreteWindow | null {
  const t = toDate(now).getTime();
  const today = localDate(now, timeZone);
  for (let k = 0; k <= 8; k++) {
    const w = windowStartingOn(addDaysToLocalDate(today, k), spec, timeZone);
    if (w && w.start.getTime() > t) return w;
  }
  return null;
}

/**
 * `isWithinQuietHours(start, end, now, tz)`: wall-clock check in the user's zone, including windows
 * that cross midnight (22:30–07:30). `start === end` means no quiet window.
 */
export function isWithinQuietHours(
  start: LocalTimeString,
  end: LocalTimeString,
  now: Instant,
  timeZone: string,
  days?: readonly number[],
): boolean {
  const spec: QuietWindowSpec = days ? { start, end, days } : { start, end };
  return quietWindowContaining(spec, now, timeZone) !== null;
}

/** Epoch seconds of an instant (used by deterministic keys). */
export function epochSeconds(instant: Instant): number {
  return Math.floor(toDate(instant).getTime() / 1000);
}

/** ISO 8601 UTC string of an instant. */
export function toIso(instant: Instant): string {
  return toDate(instant).toISOString();
}
