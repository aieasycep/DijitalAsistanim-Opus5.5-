import { z } from 'zod';
import { NOTIFICATION_DETAIL_VALUES, RETENTION_POLICY_VALUES, USER_STATE_VALUES } from '@da/domain';
import {
  AccountSummary,
  ApprovalActionType,
  Email,
  EntitlementState,
  IanaTimeZone,
  IsoDateTime,
  Locale,
  LocalTime,
  UsageSummary,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';

const IsoWeekday = z.int().min(1).max(7);

/** `user_preferences.ai_data_access` (DB §4.1): exactly these five boolean keys. */
export const AiDataAccess = z.object({
  mail_body: z.boolean(),
  attachments: z.boolean(),
  calendar: z.boolean(),
  contacts: z.boolean(),
  location_coarse: z.boolean(),
});

/** The `user_preferences` projection returned by bootstrap (API-BOOT-01). */
export const UserPreferencesView = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  reduce_motion: z.boolean(),
  haptics_enabled: z.boolean(),
  timezone: IanaTimeZone,
  timezone_mode: z.enum(['auto', 'manual']),
  retention_policy: z.enum(RETENTION_POLICY_VALUES),
  learn_from_interactions: z.boolean(),
  ai_data_access: AiDataAccess,
  interest_categories: z.array(
    z.enum(['work', 'family', 'finance', 'travel', 'shopping', 'appointments', 'deadlines']),
  ),
  morning_enabled: z.boolean(),
  morning_time: LocalTime,
  midday_enabled: z.boolean(),
  midday_time: LocalTime,
  evening_enabled: z.boolean(),
  evening_time: LocalTime,
  weekly_enabled: z.boolean(),
  weekly_dow: IsoWeekday,
  weekly_time: LocalTime,
  briefing_weekdays: z.array(IsoWeekday).min(1),
  weekend_morning_time: LocalTime,
  weekend_morning_only: z.boolean(),
  weekend_personal_first: z.boolean(),
  working_hours_start: LocalTime,
  working_hours_end: LocalTime,
  work_days: z.array(IsoWeekday).min(1),
  default_write_calendar_id: Uuid.nullable(),
  dismissed_gates: z.record(z.string(), z.string()),
  analytics_opt_out: z.boolean(),
  screen_protection: z.boolean(),
});
export type UserPreferencesView = z.infer<typeof UserPreferencesView>;

/** The `notification_preferences` projection returned by bootstrap (API-BOOT-01). */
export const NotificationPreferencesView = z.object({
  smart_filter: z.boolean(),
  morning: z.boolean(),
  midday: z.boolean(),
  evening: z.boolean(),
  critical_email: z.boolean(),
  meeting: z.boolean(),
  deadline: z.boolean(),
  follow_up: z.boolean(),
  life_intel: z.boolean(),
  approval: z.boolean(),
  account: z.boolean(),
  quiet_hours_enabled: z.boolean(),
  quiet_start: LocalTime,
  quiet_end: LocalTime,
  quiet_days: z.array(IsoWeekday),
  vip_bypass_quiet: z.boolean(),
  meetings_bypass_quiet: z.boolean(),
  snooze_until: IsoDateTime.nullable(),
  detail_level: z.enum(NOTIFICATION_DETAIL_VALUES),
  lock_screen_private: z.boolean(),
  daily_cap: z.int().min(1).max(20),
});
export type NotificationPreferencesView = z.infer<typeof NotificationPreferencesView>;

export const BootstrapAnnouncement = z.object({
  id: Uuid,
  title: z.string(),
  body: z.string(),
  cta_route: z.string().nullable(),
  ends_at: IsoDateTime.nullable(),
});

// API-BOOT-01 · GET /me/bootstrap
export const BootstrapData = z.object({
  server_now: IsoDateTime,
  api_version: z.string(),
  demo_mode: z.boolean(),
  account_state: z.enum(USER_STATE_VALUES),
  profile: z.object({
    id: Uuid,
    display_name: z.string().nullable(),
    email: Email.nullable(),
    auth_providers: z.array(z.enum(['apple', 'google', 'azure', 'email'])),
    created_at: IsoDateTime,
    onboarding: z.object({ step: z.string().nullable(), completed_at: IsoDateTime.nullable() }),
  }),
  preferences: UserPreferencesView,
  locale: Locale,
  notification_preferences: NotificationPreferencesView,
  entitlement: EntitlementState,
  usage: UsageSummary,
  flags: z.record(z.string(), z.boolean()),
  config: z.object({
    upgrade_required: z.boolean(),
    min_supported_version: z.object({ ios: z.string(), android: z.string() }),
    referral_reward_days: z.int(),
    referral_max_rewards_per_year: z.int(),
    undo_window_seconds: z.literal(5),
  }),
  counts: z.object({
    pending_approvals: z.int(),
    open_followups: z.int(),
    open_commitments: z.int(),
  }),
  pending_device_approvals: z.array(
    z.object({ approval_id: Uuid, action_type: ApprovalActionType, approved_at: IsoDateTime }),
  ),
  accounts: z.array(AccountSummary),
  announcements: z.array(BootstrapAnnouncement),
  service_status: z.object({
    unavailable_features: z.array(
      z.object({
        feature: z.string(),
        reason: z.enum(['external_credential_required', 'feature_disabled', 'provider_outage']),
      }),
    ),
  }),
});
export type BootstrapData = z.infer<typeof BootstrapData>;
export const BootstrapResponse = Success(BootstrapData);

// API-BOOT-02 · GET /me/entitlements
export const EntitlementsResponse = Success(
  z.object({ entitlement: EntitlementState, usage: UsageSummary }),
);
