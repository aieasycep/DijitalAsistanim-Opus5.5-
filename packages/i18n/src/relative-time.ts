/**
 * Relative time with date-fns (`formatDistance`, `formatRelative`) and its `tr` / `enGB` locale
 * data. `Intl.RelativeTimeFormat` is deliberately not used: Hermes does not implement it
 * (KNOWN_PLATFORM_LIMITATIONS), and date-fns gives identical output on every runtime.
 */
import {
  differenceInCalendarDays,
  format,
  formatDistance,
  formatRelative,
  type FormatRelativeToken,
  type Locale as DateFnsLocale,
} from 'date-fns';

import { DATE_FNS_LOCALES, DEFAULT_TIME_ZONE, toZonedDate, type DateInput } from './formats.ts';
import type { Locale } from './locales.ts';

export interface RelativeTimeOptions {
  locale?: Locale;
  /** The reference instant; defaults to now. */
  now?: DateInput;
  /** IANA zone used for calendar-day boundaries; defaults to `Europe/Istanbul`. */
  timeZone?: string;
}

function toTime(input: DateInput): number {
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(time)) throw new RangeError(`Invalid date: ${String(input)}`);
  return time;
}

/**
 * "3 gün önce" / "3 days ago", or "5 dakika içinde" / "in 5 minutes" for future instants.
 * Set `addSuffix: false` for a bare distance ("3 gün").
 */
export function formatTimeAgo(
  input: DateInput,
  {
    locale = 'tr',
    now = Date.now(),
    addSuffix = true,
  }: Omit<RelativeTimeOptions, 'timeZone'> & { addSuffix?: boolean } = {},
): string {
  return formatDistance(toTime(input), toTime(now), {
    addSuffix,
    locale: DATE_FNS_LOCALES[locale],
  });
}

/** Patterns for `formatRelative` tokens, matching the design ("Dün 15:40"). 24-hour always. */
const RELATIVE_PATTERNS: Readonly<Record<Locale, Readonly<Record<FormatRelativeToken, string>>>> = {
  tr: {
    lastWeek: 'EEEE HH:mm',
    yesterday: "'Dün' HH:mm",
    today: "'Bugün' HH:mm",
    tomorrow: "'Yarın' HH:mm",
    nextWeek: 'EEEE HH:mm',
    other: 'd MMMM yyyy',
  },
  en: {
    lastWeek: 'EEEE HH:mm',
    yesterday: "'Yesterday' HH:mm",
    today: "'Today' HH:mm",
    tomorrow: "'Tomorrow' HH:mm",
    nextWeek: 'EEEE HH:mm',
    other: 'd MMMM yyyy',
  },
};

function relativeLocale(locale: Locale): DateFnsLocale {
  return {
    ...DATE_FNS_LOCALES[locale],
    formatRelative: (token) => RELATIVE_PATTERNS[locale][token],
  };
}

/**
 * A calendar-aware label: "Bugün 09:40", "Dün 15:40", "Yarın 09:15", "Pazartesi 10:00" within a
 * week, otherwise "5 Eylül" (same year) or "5 Eylül 2025". Day boundaries follow `timeZone`.
 */
export function formatRelativeDay(
  input: DateInput,
  { locale = 'tr', now = Date.now(), timeZone = DEFAULT_TIME_ZONE }: RelativeTimeOptions = {},
): string {
  const date = toZonedDate(input, timeZone);
  const base = toZonedDate(now, timeZone);
  const days = differenceInCalendarDays(date, base);
  if (Math.abs(days) >= 7) {
    const pattern = date.getFullYear() === base.getFullYear() ? 'd MMMM' : 'd MMMM yyyy';
    return format(date, pattern, { locale: DATE_FNS_LOCALES[locale] });
  }
  return formatRelative(date, base, { locale: relativeLocale(locale) });
}

/**
 * Whole calendar days from `from` to `to` in the zone (positive when `to` is later), e.g. the
 * `{days}` in "3 gündür yanıt yok".
 */
export function calendarDaysBetween(
  from: DateInput,
  to: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  return differenceInCalendarDays(toZonedDate(to, timeZone), toZonedDate(from, timeZone));
}
