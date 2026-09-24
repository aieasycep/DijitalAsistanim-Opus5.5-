/**
 * Today hero mode (Annex M-TD-01-A), resolved in its precedence order from the real state:
 * no sources → silent day → evening (confirmed / ready / Free gate) → midday (ready / Free gate /
 * skipped) → morning ready or first day → generating → failed → before the morning briefing →
 * a plain day. Windows: midday = [midday_time, evening_time), evening = [evening_time, 04:00); on
 * weekend days with `weekend_morning_only` only the morning runs, at `weekend_morning_time`.
 */
import { toLocalDateString, toZonedDate } from '@da/i18n';
import type { UserPreferencesView } from '@da/validation/api/bootstrap';

import type { BriefingSummary } from './data';

export type HeroMode =
  | 'no_sources'
  | 'silent_day'
  | 'evening_confirmed'
  | 'evening_ready'
  | 'evening_gate'
  | 'midday_ready'
  | 'midday_gate'
  | 'morning_ready'
  | 'first_day'
  | 'generating'
  | 'morning_failed'
  | 'pre_morning'
  | 'day';

export interface HeroInput {
  readonly now: Date;
  readonly prefs: UserPreferencesView;
  readonly pro: boolean;
  readonly hasSources: boolean;
  readonly count: number;
  readonly localDate: string;
  readonly briefings: readonly BriefingSummary[];
  readonly gateDismissed: (feature: 'midday' | 'evening') => boolean;
  /** The first day after onboarding (`briefings.origin = 'onboarding'` on today's morning). */
}

export interface HeroState {
  readonly mode: HeroMode;
  readonly briefing: BriefingSummary | null;
  /** Midday ran but found nothing (D-14): the morning hero shows the no-change context. */
  readonly middaySkipped: boolean;
}

function minutesOf(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

const READY = new Set(['ready', 'delivered']);

export function isWeekendDay(isoWeekday: number): boolean {
  return isoWeekday === 6 || isoWeekday === 7;
}

export function resolveHero(input: HeroInput): HeroState {
  const { prefs, now } = input;
  const today = input.briefings.filter((b) => b.local_date === input.localDate);
  const byKind = (kind: BriefingSummary['kind']) => today.find((b) => b.kind === kind) ?? null;
  const morning = byKind('morning');
  const midday = byKind('midday');
  const evening = byKind('evening');
  if (!input.hasSources) return { mode: 'no_sources', briefing: null, middaySkipped: false };

  const zoned = toZonedDate(now, prefs.timezone);
  const weekday = ((zoned.getDay() + 6) % 7) + 1;
  const minutes = zoned.getHours() * 60 + zoned.getMinutes();
  if (!prefs.briefing_weekdays.includes(weekday)) {
    return { mode: 'silent_day', briefing: null, middaySkipped: false };
  }
  const morningOnly = prefs.weekend_morning_only && isWeekendDay(weekday);
  const morningAt = minutesOf(morningOnly ? prefs.weekend_morning_time : prefs.morning_time);
  const middayAt = minutesOf(prefs.midday_time);
  const eveningAt = minutesOf(prefs.evening_time);
  const inEvening = !morningOnly && (minutes >= eveningAt || minutes < 4 * 60);
  const inMidday = !morningOnly && minutes >= middayAt && minutes < eveningAt;

  if (inEvening) {
    if ((evening?.evening_ready_at ?? null) !== null) {
      return { mode: 'evening_confirmed', briefing: evening, middaySkipped: false };
    }
    if (input.pro && evening !== null && READY.has(evening.status)) {
      return { mode: 'evening_ready', briefing: evening, middaySkipped: false };
    }
    if (!input.pro && input.count > 0 && !input.gateDismissed('evening')) {
      return { mode: 'evening_gate', briefing: null, middaySkipped: false };
    }
  }
  let middaySkipped = false;
  if (inMidday) {
    if (input.pro && midday !== null && READY.has(midday.status)) {
      return { mode: 'midday_ready', briefing: midday, middaySkipped: false };
    }
    if (!input.pro && input.count > 0 && !input.gateDismissed('midday')) {
      return { mode: 'midday_gate', briefing: null, middaySkipped: false };
    }
    middaySkipped = midday?.status === 'skipped';
  }
  if (morning !== null) {
    if (READY.has(morning.status)) {
      return {
        mode: morning.origin === 'onboarding' ? 'first_day' : 'morning_ready',
        briefing: morning,
        middaySkipped,
      };
    }
    if (morning.status === 'scheduled' || morning.status === 'generating') {
      return { mode: 'generating', briefing: morning, middaySkipped: false };
    }
    if (morning.status === 'failed') {
      return { mode: 'morning_failed', briefing: morning, middaySkipped: false };
    }
  }
  if (minutes < morningAt && minutes >= 4 * 60) {
    return { mode: 'pre_morning', briefing: null, middaySkipped: false };
  }
  return { mode: 'day', briefing: null, middaySkipped };
}

/** The local calendar date of `now` in the user's zone. */
export function localDateOf(now: Date, timeZone: string): string {
  return toLocalDateString(now, timeZone);
}

/** The analytics vocabulary of hero modes (`today_viewed.hero_mode`). */
export function analyticsHeroMode(
  mode: HeroMode,
):
  | 'morning_ready'
  | 'briefing_generating'
  | 'midday_ready'
  | 'evening_ready'
  | 'no_sources'
  | 'first_run'
  | 'all_clear'
  | 'weekend' {
  switch (mode) {
    case 'no_sources':
      return 'no_sources';
    case 'first_day':
      return 'first_run';
    case 'generating':
      return 'briefing_generating';
    case 'midday_ready':
    case 'midday_gate':
      return 'midday_ready';
    case 'evening_ready':
    case 'evening_gate':
    case 'evening_confirmed':
      return 'evening_ready';
    case 'silent_day':
      return 'weekend';
    case 'day':
    case 'pre_morning':
      return 'all_clear';
    default:
      return 'morning_ready';
  }
}
