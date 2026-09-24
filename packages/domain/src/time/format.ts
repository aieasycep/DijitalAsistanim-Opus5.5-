/**
 * Locale-aware formatting in the user's time zone (ADR-14): 24-hour clock everywhere, date-fns
 * locales for month/weekday names and relative distances (Hermes lacks `Intl.RelativeTimeFormat`).
 */
import { TZDate } from '@date-fns/tz';
import { format, formatDistanceStrict } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import { type Instant, localTime, toDate } from './zone.ts';

export type AppLocale = 'tr' | 'en';

const LOCALES = { tr, en: enUS } as const;

/** `HH:mm` in the user's zone (never AM/PM, in every locale). */
export function formatTime(instant: Instant, timeZone: string): string {
  return localTime(instant, timeZone);
}

/** Formats an instant with a date-fns pattern in the user's zone. */
export function formatInZone(
  instant: Instant,
  timeZone: string,
  pattern: string,
  locale: AppLocale = 'tr',
): string {
  const zoned = new TZDate(toDate(instant).getTime(), timeZone);
  return format(zoned, pattern, { locale: LOCALES[locale] });
}

/** "23 Eylül 2026" / "23 September 2026". */
export function formatDate(instant: Instant, timeZone: string, locale: AppLocale = 'tr'): string {
  return formatInZone(instant, timeZone, 'd MMMM yyyy', locale);
}

/** "23 Eyl" / "23 Sep". */
export function formatShortDate(
  instant: Instant,
  timeZone: string,
  locale: AppLocale = 'tr',
): string {
  return formatInZone(instant, timeZone, 'd MMM', locale);
}

/** "25 Eylül Cuma" / "25 September Friday". */
export function formatDateWithWeekday(
  instant: Instant,
  timeZone: string,
  locale: AppLocale = 'tr',
): string {
  return formatInZone(instant, timeZone, 'd MMMM EEEE', locale);
}

/** Relative distance with suffix: "3 gün önce", "2 saat sonra". */
export function formatRelativeDistance(
  instant: Instant,
  now: Instant,
  locale: AppLocale = 'tr',
): string {
  return formatDistanceStrict(toDate(instant), toDate(now), {
    addSuffix: true,
    locale: LOCALES[locale],
  });
}
