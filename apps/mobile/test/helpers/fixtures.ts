import type { AccountSummary } from '@da/validation/api/common';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import type { Session } from '@supabase/supabase-js';

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TS = '2026-09-23T08:00:00Z';

export const meta = { correlation_id: 'corr-12345678', request_id: 'req-1', server_time: TS };
export const ok = (data: unknown) => ({ data, meta });

export const googleAccount: AccountSummary = {
  id: uuid(10),
  provider: 'google',
  account_email: 'ahmet@example.com',
  display_name: 'Ahmet',
  status: 'healthy',
  capabilities_granted: ['mail_read', 'calendar_read'],
  data_sources: {
    mail_read: true,
    attachments_analyze: true,
    deadline_detect: true,
    draft_replies: true,
    calendar_read: true,
    schedule_suggest: true,
    calendar_write_with_approval: true,
    tasks_read: false,
  },
  paused_by_plan: false,
  last_sync_at: TS,
  last_error_code: null,
  manual_revoke_url: null,
};

export function bootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    server_now: TS,
    api_version: '2026-09-23',
    demo_mode: false,
    account_state: 'active',
    profile: {
      id: uuid(1),
      display_name: 'Ahmet Yılmaz',
      email: 'ahmet@example.com',
      auth_providers: ['apple'],
      created_at: '2026-09-01T08:00:00Z',
      onboarding: { step: 'done', completed_at: TS },
    },
    preferences: {
      theme: 'system',
      reduce_motion: false,
      haptics_enabled: true,
      timezone: 'Europe/Istanbul',
      timezone_mode: 'auto',
      retention_policy: 'd90',
      learn_from_interactions: true,
      ai_data_access: {
        mail_body: true,
        attachments: true,
        calendar: true,
        contacts: true,
        location_coarse: false,
      },
      interest_categories: ['work'],
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
      weekend_morning_time: '10:00',
      weekend_morning_only: true,
      weekend_personal_first: true,
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      work_days: [1, 2, 3, 4, 5],
      default_write_calendar_id: null,
      dismissed_gates: {},
      analytics_opt_out: false,
      screen_protection: false,
    },
    locale: 'tr-TR',
    notification_preferences: {
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
      meetings_bypass_quiet: false,
      snooze_until: null,
      detail_level: 'title_only',
      lock_screen_private: true,
      daily_cap: 5,
    },
    entitlement: {
      is_active: false,
      source: 'none',
      active_until: null,
      store: {
        active: false,
        product_id: null,
        store: null,
        period_type: null,
        will_renew: false,
        expires_at: null,
        billing_issue: false,
        management_url: null,
      },
      grants: [],
    },
    usage: {
      plan: 'free',
      resets_at: TS,
      limits: {},
      ai_budget: { state: 'ok', level: 'L0' },
      ai_units: { limit: 50, used: 0, remaining: 50 },
    },
    flags: {},
    config: {
      upgrade_required: false,
      min_supported_version: { ios: '1.0.0', android: '1.0.0' },
      referral_reward_days: 14,
      referral_max_rewards_per_year: 6,
      undo_window_seconds: 5,
    },
    counts: { pending_approvals: 0, open_followups: 0, open_commitments: 0 },
    pending_device_approvals: [],
    accounts: [googleAccount],
    announcements: [],
    service_status: { unavailable_features: [] },
    ...overrides,
  };
}

export function session(userId: string = uuid(1)): Session {
  return {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-09-01T08:00:00Z',
    },
  };
}

export const errorBody = (code: string, retryable = false) => ({
  error: {
    code,
    message: code,
    message_key: `errors.${code.toLowerCase()}`,
    retryable,
    correlation_id: 'corr-server-1',
  },
});
