import type { Locale } from '@da/i18n';

/**
 * Formats a calendar date (`YYYY-MM-DD`) as "24 Eylül 2026" / "24 September 2026" — the same
 * `d MMMM yyyy` shape as `@da/i18n` `formatDate`. Implemented with `Intl` on a fixed UTC instant
 * because prerendered pages must not construct "now" (`@date-fns/tz` does internally).
 */
export function formatCalendarDate(isoDate: string, locale: Locale): string {
  const instant = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(instant);
}
