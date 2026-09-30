/*
 * tr-TR / en-US formatting for the backoffice (BACKOFFICE_PLAN §5.8): numbers `1.234`, USD with 4
 * decimals below 1, 24-hour `dd.MM.yyyy HH:mm` in the admin's timezone (default Europe/Istanbul).
 */

export type UiLocale = 'tr' | 'en';

const INTL: Readonly<Record<UiLocale, string>> = { tr: 'tr-TR', en: 'en-US' };
export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export function formatNumber(locale: UiLocale, value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(INTL[locale], { maximumFractionDigits }).format(value);
}

export function formatUsd(locale: UiLocale, value: number): string {
  return new Intl.NumberFormat(INTL[locale], {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(value) < 1 && value !== 0 ? 4 : 2,
  }).format(value);
}

/** A ratio (0.123) as a percentage with one decimal: `%12,3` / `12.3%`. */
export function formatPercent(locale: UiLocale, ratio: number): string {
  return new Intl.NumberFormat(INTL[locale], { style: 'percent', maximumFractionDigits: 1 }).format(
    ratio,
  );
}

export function formatDateTime(locale: UiLocale, iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function formatDay(locale: UiLocale, iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone, day: '2-digit', month: 'short' }).format(
    new Date(iso),
  );
}

/** `mm:ss` for the session countdown. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Relative change of `delta` as returned by admin-api (a ratio, e.g. 0.12 = +12 %). */
export function deltaDirection(delta: number | null): 'up' | 'down' | 'flat' | 'none' {
  if (delta === null || Number.isNaN(delta)) return 'none';
  if (Math.abs(delta) < 0.0005) return 'flat';
  return delta > 0 ? 'up' : 'down';
}
