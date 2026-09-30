/**
 * User settings rows (`user_preferences`, `notification_preferences`) with their database
 * defaults (DATABASE_AND_RLS_PLAN §4.1). Engines take these rows as input; the defaults below are
 * the single source used by tests and by server fallbacks when a row is not yet created.
 */
import type { NotificationDetail, RetentionPolicy } from '../enums.ts';
import type { IsoDateTime, LocalTime, Uuid } from './common.ts';

export type ReplyTone = 'short' | 'professional' | 'friendly' | 'detailed';
export type InterestCategory =
  'work' | 'family' | 'finance' | 'travel' | 'shopping' | 'appointments' | 'deadlines';

export interface UserPreferences {
  readonly user_id: Uuid;
  readonly timezone: string;
  readonly retention_policy: RetentionPolicy;
  readonly learn_from_interactions: boolean;
  readonly interest_categories: readonly InterestCategory[];
  readonly morning_enabled: boolean;
  readonly morning_time: LocalTime;
  readonly midday_enabled: boolean;
  readonly midday_time: LocalTime;
  readonly evening_enabled: boolean;
  readonly evening_time: LocalTime;
  readonly weekly_enabled: boolean;
  /** ISO weekday, 7 = Sunday. */
  readonly weekly_dow: number;
  readonly weekly_time: LocalTime;
  readonly briefing_weekdays: readonly number[];
  readonly working_hours_start: LocalTime;
  readonly working_hours_end: LocalTime;
  readonly work_days: readonly number[];
  readonly default_reply_tone: ReplyTone;
  /** Smart Follow-Up nudge threshold (1..14, default 2). */
  readonly follow_up_after_days: number;
  readonly analytics_opt_out: boolean;
}

export const DEFAULT_USER_PREFERENCES: Omit<UserPreferences, 'user_id'> = {
  timezone: 'Europe/Istanbul',
  retention_policy: 'd90',
  learn_from_interactions: true,
  interest_categories: [],
  morning_enabled: true,
  morning_time: '08:00',
  midday_enabled: true,
  midday_time: '13:00',
  evening_enabled: true,
  evening_time: '19:00',
  weekly_enabled: true,
  weekly_dow: 7,
  weekly_time: '18:00',
  briefing_weekdays: [1, 2, 3, 4, 5, 6, 7],
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  work_days: [1, 2, 3, 4, 5],
  default_reply_tone: 'professional',
  follow_up_after_days: 2,
  analytics_opt_out: false,
};

/** Category switches of `notification_preferences` (one boolean column per category). */
export interface NotificationCategorySwitches {
  readonly morning: boolean;
  readonly midday: boolean;
  readonly evening: boolean;
  readonly critical_email: boolean;
  readonly meeting: boolean;
  readonly deadline: boolean;
  readonly follow_up: boolean;
  readonly life_intel: boolean;
  readonly approval: boolean;
  readonly account: boolean;
}

export interface NotificationPreferences extends NotificationCategorySwitches {
  readonly user_id: Uuid;
  /** "Yalnızca gerçekten önemliyse bildir" — only `urgent`/`today` pass (SREQ-60). */
  readonly smart_filter: boolean;
  readonly quiet_hours_enabled: boolean;
  readonly quiet_start: LocalTime;
  readonly quiet_end: LocalTime;
  readonly quiet_days: readonly number[];
  readonly vip_bypass_quiet: boolean;
  readonly detail_level: NotificationDetail;
  readonly lock_screen_private: boolean;
  /** Non-critical rolling 24 h cap (R-14). */
  readonly daily_cap: number;
  readonly snooze_until: IsoDateTime | null;
  readonly meeting_prep_lead_min: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, 'user_id'> = {
  smart_filter: true,
  morning: true,
  midday: true,
  evening: true,
  critical_email: true,
  meeting: true,
  deadline: true,
  follow_up: true,
  life_intel: false,
  approval: true,
  account: true,
  quiet_hours_enabled: true,
  quiet_start: '22:30',
  quiet_end: '07:30',
  quiet_days: [1, 2, 3, 4, 5, 6, 7],
  vip_bypass_quiet: true,
  detail_level: 'title_only',
  lock_screen_private: true,
  daily_cap: 5,
  snooze_until: null,
  meeting_prep_lead_min: 30,
};
