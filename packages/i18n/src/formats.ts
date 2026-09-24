/**
 * Date, time, number and currency formatting (ADR-14, M§39).
 *
 * - The clock is 24-hour in both locales (`HH:mm`); dates read `d MMMM yyyy` ("5 Eylül 2026").
 * - Dates and times are formatted with date-fns in an explicit IANA time zone through
 *   `@date-fns/tz`, never with the device zone, because briefings, quiet hours and "today" are
 *   evaluated in `user_preferences.timezone` (default `Europe/Istanbul`), which is stored separately
 *   from the profile. Every helper takes the zone as a parameter.
 * - English uses date-fns `enGB` data so the 24-hour clock and day-month order hold, and
 *   `Intl.NumberFormat('en-US')` for numbers and currency.
 * - Messages receive preformatted strings (`{time}`, `{date}`, `{amount}`) rather than ICU
 *   `{d, date}` arguments, so output is identical on Hermes, Node and browsers.
 */
import { TZDate } from '@date-fns/tz';
import { format, type Locale as DateFnsLocale } from 'date-fns';
// Per-locale subpaths: the `date-fns/locale` barrel would put every locale into the Metro bundle.
import { enGB } from 'date-fns/locale/en-GB';
import { tr as trDateLocale } from 'date-fns/locale/tr';

import { INTL_LOCALE, type Locale } from './locales.ts';

export const DEFAULT_TIME_ZONE = 'Europe/Istanbul';
export const DEFAULT_CURRENCY = 'TRY';

/** date-fns locale data per app locale. */
export const DATE_FNS_LOCALES: Readonly<Record<Locale, DateFnsLocale>> = {
  tr: trDateLocale,
  en: enGB,
};

/** date-fns patterns per locale. Times are always 24-hour. */
export const DATE_PATTERNS = {
  time: { tr: 'HH:mm', en: 'HH:mm' },
  date: { tr: 'd MMMM yyyy', en: 'd MMMM yyyy' },
  dayMonth: { tr: 'd MMMM', en: 'd MMMM' },
  weekdayDayMonth: { tr: 'd MMMM EEEE', en: 'EEEE d MMMM' },
  dateTime: { tr: 'd MMMM yyyy HH:mm', en: 'd MMMM yyyy, HH:mm' },
  dayMonthTime: { tr: 'd MMMM HH:mm', en: 'd MMMM, HH:mm' },
  weekday: { tr: 'EEEE', en: 'EEEE' },
  weekdayShort: { tr: 'EEE', en: 'EEE' },
} as const satisfies Record<string, Record<Locale, string>>;

export type DatePattern = keyof typeof DATE_PATTERNS;

export type DateInput = Date | number | string;

export interface ZonedFormatOptions {
  locale?: Locale;
  /** IANA zone; defaults to `Europe/Istanbul`. Pass the user's `user_preferences.timezone`. */
  timeZone?: string;
}

/** The instant as a date-fns `TZDate` in the given zone. */
export function toZonedDate(input: DateInput, timeZone: string = DEFAULT_TIME_ZONE): TZDate {
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(time)) throw new RangeError(`Invalid date: ${String(input)}`);
  return new TZDate(time, timeZone);
}

/** Formats with one of the named `DATE_PATTERNS` in the given zone and locale. */
export function formatDatePattern(
  input: DateInput,
  pattern: DatePattern,
  { locale = 'tr', timeZone = DEFAULT_TIME_ZONE }: ZonedFormatOptions = {},
): string {
  return format(toZonedDate(input, timeZone), DATE_PATTERNS[pattern][locale], {
    locale: DATE_FNS_LOCALES[locale],
  });
}

/** "09:40" */
export function formatTime(input: DateInput, options?: ZonedFormatOptions): string {
  return formatDatePattern(input, 'time', options);
}

/** "5 Eylül 2026" / "5 September 2026" */
export function formatDate(input: DateInput, options?: ZonedFormatOptions): string {
  return formatDatePattern(input, 'date', options);
}

/** "5 Eylül" / "5 September" */
export function formatDayMonth(input: DateInput, options?: ZonedFormatOptions): string {
  return formatDatePattern(input, 'dayMonth', options);
}

/** "5 Eylül Cumartesi" / "Saturday 5 September" (header kickers; upper-case with `toUpper`). */
export function formatWeekdayDate(input: DateInput, options?: ZonedFormatOptions): string {
  return formatDatePattern(input, 'weekdayDayMonth', options);
}

/** "5 Eylül 2026 09:40" / "5 September 2026, 09:40" */
export function formatDateTime(input: DateInput, options?: ZonedFormatOptions): string {
  return formatDatePattern(input, 'dateTime', options);
}

/** "14:00–16:30" (en dash, no spaces). */
export function formatTimeRange(
  start: DateInput,
  end: DateInput,
  options?: ZonedFormatOptions,
): string {
  return `${formatTime(start, options)}–${formatTime(end, options)}`;
}

/** The calendar date in the zone as `yyyy-MM-dd` (briefing `local_date`, dedupe keys). */
export function toLocalDateString(input: DateInput, timeZone: string = DEFAULT_TIME_ZONE): string {
  return format(toZonedDate(input, timeZone), 'yyyy-MM-dd');
}

/** Hour and minute of the instant in the zone, e.g. for quiet-hours checks and time chips. */
export function zonedClock(
  input: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): { hours: number; minutes: number } {
  const zoned = toZonedDate(input, timeZone);
  return { hours: zoned.getHours(), minutes: zoned.getMinutes() };
}

export function formatNumber(
  value: number | bigint,
  locale: Locale = 'tr',
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], options).format(value);
}

export interface CurrencyFormatOptions {
  /** ISO 4217 code; defaults to TRY. */
  currency?: string;
  /** Drop ",00" on whole amounts ("₺199" instead of "₺199,00"), as on the pricing page. */
  trimWholeFraction?: boolean;
}

/**
 * `Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY'})` → "₺1.842,00";
 * English uses `en-US` → "TRY 1,842.00".
 */
export function formatCurrency(
  amount: number,
  locale: Locale = 'tr',
  { currency = DEFAULT_CURRENCY, trimWholeFraction = false }: CurrencyFormatOptions = {},
): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency,
    ...(trimWholeFraction && whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(amount);
}

/** A ratio as a percentage: 0.38 → "%38" (tr) / "38%" (en). */
export function formatPercent(
  ratio: number,
  locale: Locale = 'tr',
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'percent',
    maximumFractionDigits,
  }).format(ratio);
}

const DURATION_UNITS: Readonly<Record<Locale, { hour: string; minute: string }>> = {
  tr: { hour: 'sa', minute: 'dk' },
  en: { hour: 'h', minute: 'min' },
};

/** Compact durations used in meta lines: 168 → "2 sa 48 dk" / "2 h 48 min", 45 → "45 dk". */
export function formatDuration(totalMinutes: number, locale: Locale = 'tr'): string {
  const minutesTotal = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const unit = DURATION_UNITS[locale];
  if (hours === 0) return `${minutes} ${unit.minute}`;
  if (minutes === 0) return `${hours} ${unit.hour}`;
  return `${hours} ${unit.hour} ${minutes} ${unit.minute}`;
}

/** Audio length for "Dinle · {minutes} dk": whole minutes, at least 1. */
export function audioMinutes(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds / 60));
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** 1_250_000 → "1,2 MB" (tr) / "1.2 MB" (en); decimal (SI) units as shown by the stores. */
export function formatFileSize(bytes: number, locale: Locale = 'tr'): string {
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${formatNumber(value, locale, { maximumFractionDigits: digits })} ${FILE_SIZE_UNITS[unitIndex] ?? 'B'}`;
}
