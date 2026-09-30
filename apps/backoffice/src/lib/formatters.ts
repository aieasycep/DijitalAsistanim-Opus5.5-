import {
  DEFAULT_TIMEZONE,
  formatDateTime,
  formatDay,
  formatNumber,
  formatPercent,
  formatUsd,
  type UiLocale,
} from './format';

/*
 * Formatters bound to the admin's locale and timezone (BACKOFFICE_PLAN §5.8), shared by server
 * components (`getFormatters`) and client islands (`useFormatters`): numbers `1.234`, USD, ratios as
 * percentages, 24-hour date-times in the admin's zone, durations `850 ms` / `1,2 sn` / `3 dk`, and
 * relative times. `null` values render as the em dash.
 */

const INTL: Readonly<Record<UiLocale, string>> = { tr: 'tr-TR', en: 'en-US' };
export const EMPTY = '—';

export interface Formatters {
  readonly locale: UiLocale;
  readonly timeZone: string;
  number(value: number | null | undefined, digits?: number): string;
  usd(value: number | null | undefined): string;
  percent(ratio: number | null | undefined): string;
  dateTime(iso: string | null | undefined): string;
  day(iso: string | null | undefined): string;
  /** A `YYYY-MM-DD` local date as `dd.MM.yyyy` / `MM/dd/yyyy`. */
  localDate(date: string | null | undefined): string;
  duration(ms: number | null | undefined): string;
  relative(iso: string | null | undefined, now?: number): string;
}

function unit(locale: UiLocale, name: 'millisecond' | 'second' | 'minute' | 'hour', value: number) {
  return new Intl.NumberFormat(INTL[locale], {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
    maximumFractionDigits: name === 'millisecond' ? 0 : 1,
  }).format(value);
}

export function formatDuration(locale: UiLocale, ms: number): string {
  if (ms < 1000) return unit(locale, 'millisecond', ms);
  if (ms < 60_000) return unit(locale, 'second', ms / 1000);
  if (ms < 3_600_000) return unit(locale, 'minute', ms / 60_000);
  return unit(locale, 'hour', ms / 3_600_000);
}

export function formatRelative(locale: UiLocale, iso: string, now: number = Date.now()): string {
  const diffSeconds = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(INTL[locale], { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  return rtf.format(Math.round(diffSeconds / 86_400), 'day');
}

export function createFormatters(
  locale: UiLocale,
  timeZone: string = DEFAULT_TIMEZONE,
): Formatters {
  return {
    locale,
    timeZone,
    number: (value, digits = 0) =>
      value === null || value === undefined ? EMPTY : formatNumber(locale, value, digits),
    usd: (value) => (value === null || value === undefined ? EMPTY : formatUsd(locale, value)),
    percent: (ratio) =>
      ratio === null || ratio === undefined ? EMPTY : formatPercent(locale, ratio),
    dateTime: (iso) =>
      iso === null || iso === undefined ? EMPTY : formatDateTime(locale, iso, timeZone),
    day: (iso) => (iso === null || iso === undefined ? EMPTY : formatDay(locale, iso, timeZone)),
    localDate: (date) => {
      if (date === null || date === undefined) return EMPTY;
      const [y, m, d] = date.split('-');
      if (y === undefined || m === undefined || d === undefined) return date;
      return locale === 'tr' ? `${d}.${m}.${y}` : `${m}/${d}/${y}`;
    },
    duration: (ms) => (ms === null || ms === undefined ? EMPTY : formatDuration(locale, ms)),
    relative: (iso, now) =>
      iso === null || iso === undefined ? EMPTY : formatRelative(locale, iso, now),
  };
}

/** `YYYY-MM-DD` of `now` in `timeZone`. */
export function localDateIn(timeZone: string, now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return parts;
}

/** Whole days between two `YYYY-MM-DD` dates (`b − a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The first 8 characters of a uuid, as lists show it (`3f9a2c1b`). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The last 6 characters of an id: the L3 typed-confirmation token (§5.4). */
export function confirmToken(id: string): string {
  return id.slice(-6);
}
