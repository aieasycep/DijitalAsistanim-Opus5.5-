import type { BootstrapData } from '@da/validation/api/bootstrap';

export const TS = '2026-09-24T08:00:00Z';
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const meta = { correlation_id: 'corr-12345678', request_id: 'req-1', server_time: TS };
export const ok = (data: unknown) => ({ data, meta });

export const bootstrapData = {
  server_now: TS,
  api_version: '2026-09-23',
  demo_mode: false,
  account_state: 'active',
  profile: {
    id: uuid(2),
    display_name: 'Yunus',
    email: 'yunus@example.com',
    auth_providers: ['apple'],
    created_at: TS,
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
    ai_units: { limit: 50, used: 3, remaining: 47 },
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
  accounts: [],
  announcements: [],
  service_status: { unavailable_features: [] },
} satisfies BootstrapData;

export const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({
  error: {
    code,
    message: 'Bir sorun oluştu.',
    message_key: `errors.${code.toLowerCase()}`,
    retryable: false,
    correlation_id: 'corr-server-1',
    ...extra,
  },
});

export interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Record<string, string>;
}

/** A fetch mock that records requests and answers from a queue of responders. */
export function mockFetch(...responders: ((call: Recorded) => Response | Promise<Response>)[]) {
  const calls: Recorded[] = [];
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const call = { url, init, headers };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (responder === undefined) throw new Error('no responder');
    return responder(call);
  };
  return { fn, calls };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
