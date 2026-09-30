/**
 * Briefing schedule rules (M-ON-10T): 24-hour local times on a 5-minute grid, per-field ranges
 * (morning 05:00–11:55, midday 11:00–15:55, evening 16:00–23:00, weekend 06:00–12:00) and the order
 * morning < midday < evening with gaps of at least 60 minutes.
 */
export type ScheduleField = 'morning' | 'midday' | 'evening' | 'weekend';

export interface ScheduleTimes {
  readonly morning: string;
  readonly midday: string;
  readonly evening: string;
  readonly weekend: string;
}

export const DEFAULT_TIMES: ScheduleTimes = {
  morning: '08:00',
  midday: '13:00',
  evening: '19:00',
  weekend: '10:00',
};

const RANGES: Readonly<Record<ScheduleField, readonly [number, number]>> = {
  morning: [5 * 60, 11 * 60 + 55],
  midday: [11 * 60, 15 * 60 + 55],
  evening: [16 * 60, 23 * 60],
  weekend: [6 * 60, 12 * 60],
};

export const MIN_GAP_MIN = 60;

export function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Rounds to the nearest 5 minutes (the Android dialog allows any minute). */
export function roundToFive(time: string): string {
  return fromMinutes(Math.round(toMinutes(time) / 5) * 5);
}

/** Normalises a DB `time` value (`08:00:00`) to `HH:MM`. */
export function hhmm(value: string): string {
  return value.slice(0, 5);
}

export function clampToRange(field: ScheduleField, minutes: number): number {
  const [min, max] = RANGES[field];
  return Math.max(min, Math.min(max, minutes));
}

export type ScheduleError =
  | { readonly kind: 'range'; readonly field: ScheduleField }
  | { readonly kind: 'order'; readonly first: ScheduleField; readonly second: ScheduleField };

/** The first rule a candidate value breaks, or null. */
export function validateTime(
  field: ScheduleField,
  value: string,
  times: ScheduleTimes,
): ScheduleError | null {
  const minutes = toMinutes(value);
  const [min, max] = RANGES[field];
  if (minutes < min || minutes > max || minutes % 5 !== 0) return { kind: 'range', field };
  if (field === 'weekend') return null;
  const next = { ...times, [field]: value };
  if (toMinutes(next.midday) - toMinutes(next.morning) < MIN_GAP_MIN) {
    return { kind: 'order', first: 'morning', second: 'midday' };
  }
  if (toMinutes(next.evening) - toMinutes(next.midday) < MIN_GAP_MIN) {
    return { kind: 'order', first: 'midday', second: 'evening' };
  }
  return null;
}
