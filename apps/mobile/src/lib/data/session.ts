/**
 * The signed-in user's context for feature screens, read from `GET /me/bootstrap` (already cached
 * by the shell): time zone (`user_preferences.timezone`), plan (the server stays authoritative —
 * a Pro-only call still answers 402), connected accounts and the UI locale. Plus the formatting
 * helpers every screen uses so times, dates and durations are rendered in the user's zone
 * (SCREEN_AND_FLOW_MAP Part 3 §0.9: 24 h, en dash ranges, `tr-TR` numbers).
 */
import { useBootstrap } from '@da/api-client/react';
import { addDaysToLocalDate, localDate, localDateDiffDays, type Instant } from '@da/domain';
import {
  formatDatePattern,
  formatDayMonth,
  formatDuration,
  formatTime,
  formatTimeRange,
  formatWeekdayDate,
  type Locale,
} from '@da/i18n';
import type { AccountSummary } from '@da/validation/api/common';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useLocale } from 'use-intl';

import { deviceTimeZone } from '../../i18n/I18nProvider';
import { now } from '../clock';

export interface SessionContext {
  readonly data: BootstrapData | undefined;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly isPro: boolean;
  readonly accounts: readonly AccountSummary[];
  readonly learnFromInteractions: boolean;
}

export function useSessionContext(): SessionContext {
  const { data } = useBootstrap();
  const locale = useLocale();
  return {
    data,
    timeZone: data?.preferences.timezone ?? deviceTimeZone(),
    locale,
    isPro: data?.entitlement.is_active ?? false,
    accounts: data?.accounts ?? [],
    learnFromInteractions: data?.preferences.learn_from_interactions ?? true,
  };
}

export type RelativeDay = 'today' | 'yesterday' | 'tomorrow' | 'other';

/** Formatting bound to one zone and locale. */
export interface Formats {
  readonly timeZone: string;
  readonly locale: Locale;
  /** "09:40" */
  time(at: Instant): string;
  /** "14:00–16:30" */
  range(start: Instant, end: Instant): string;
  /** "24 Eylül" */
  dayMonth(at: Instant): string;
  /** "24 Eylül Perşembe" */
  weekdayDate(at: Instant): string;
  /** "Perşembe" */
  weekday(at: Instant): string;
  /** "Per" */
  weekdayShort(at: Instant): string;
  /** "45 dk", "2 sa 30 dk" */
  duration(minutes: number): string;
  /** Today / yesterday / tomorrow relative to the clock, in the user's zone. */
  relativeDay(at: Instant): RelativeDay;
  /** The local calendar date (`yyyy-MM-dd`) of an instant. */
  localDate(at: Instant): string;
  /** Today's local date. */
  today(): string;
}

function toDateValue(at: Instant): Date {
  return at instanceof Date ? at : new Date(at);
}

export function makeFormats(timeZone: string, locale: Locale): Formats {
  const options = { timeZone, locale };
  const today = () => localDate(now(), timeZone);
  return {
    timeZone,
    locale,
    time: (at) => formatTime(toDateValue(at), options),
    range: (start, end) => formatTimeRange(toDateValue(start), toDateValue(end), options),
    dayMonth: (at) => formatDayMonth(toDateValue(at), options),
    weekdayDate: (at) => formatWeekdayDate(toDateValue(at), options),
    weekday: (at) => formatDatePattern(toDateValue(at), 'weekday', options),
    weekdayShort: (at) => formatDatePattern(toDateValue(at), 'weekdayShort', options),
    duration: (minutes) => formatDuration(minutes, locale),
    relativeDay: (at) => {
      const day = localDate(at, timeZone);
      const base = today();
      if (day === base) return 'today';
      if (day === addDaysToLocalDate(base, -1)) return 'yesterday';
      if (day === addDaysToLocalDate(base, 1)) return 'tomorrow';
      return 'other';
    },
    localDate: (at) => localDate(at, timeZone),
    today,
  };
}

export function useFormats(): Formats {
  const { timeZone, locale } = useSessionContext();
  return makeFormats(timeZone, locale);
}

/** Whole days between two instants in the zone (≥ 0). */
export function daysBetween(from: Instant, to: Instant, timeZone: string): number {
  return Math.max(0, localDateDiffDays(localDate(from, timeZone), localDate(to, timeZone)));
}

/** "2 sa" / "1 gün"-style waiting age: minutes, hours or days since `since`. */
export function ageParts(
  since: Instant,
  at: Date = now(),
): { readonly unit: 'minutes' | 'hours' | 'days'; readonly count: number } {
  const minutes = Math.max(0, Math.floor((at.getTime() - toDateValue(since).getTime()) / 60_000));
  if (minutes < 60) return { unit: 'minutes', count: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}
