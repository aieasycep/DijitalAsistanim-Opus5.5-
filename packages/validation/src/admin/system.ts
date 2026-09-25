import { z } from 'zod';
import { ADMIN_STATUS_VALUES } from '@da/domain';
import { Email, IsoDateTime, Uuid } from '../api/common.ts';
import { PricingDisplay } from '../public/schemas.ts';
import { AdminRole, MetricsRange, Reason, ReasonBody, SensitiveBody, Success } from './common.ts';

/* ADM-18 · System Health, ADM-19 · Admin users, ADM-20 · Settings, ADM-21 · Global search (§12.3). */

// ── ADM-18 System Health (+ HLT-02 probes, §14) ──────────────────────────────
export const HEALTH_PROBE_VALUES = [
  'api',
  'database',
  'supabase_auth',
  'storage',
  'google_oauth',
  'microsoft_oauth',
  'gmail',
  'microsoft_graph',
  'push',
  'ai_anthropic',
  'ai_openai',
  'ai_voyage',
  'revenuecat',
  'cron',
  'webhooks',
  'email_delivery',
  'audit_chain',
] as const;
export const HealthProbe = z.enum(HEALTH_PROBE_VALUES);
/** `system_health_checks.status`: a missing credential is never `healthy`. */
export const HealthStatus = z.enum([
  'healthy',
  'degraded',
  'down',
  'external_credential_required',
  'unknown',
]);
export const HealthSummaryResponse = Success(
  z.object({
    components: z.array(
      z.object({
        component: HealthProbe,
        status: HealthStatus,
        latency_ms: z.int().min(0).nullable(),
        checked_at: IsoDateTime,
        detail_code: z.string().nullable(),
      }),
    ),
    credential_expiry: z.array(
      z.object({
        key: z.string(),
        not_after: IsoDateTime.nullable(),
        days_left: z.int().nullable(),
      }),
    ),
  }),
);
export const HealthHistoryQuery = z.strictObject({
  component: HealthProbe,
  range: z.enum(['24h', '7d', '30d']).default('24h'),
});
export const HealthHistoryResponse = Success(
  z.array(
    z.strictObject({
      checked_at: IsoDateTime,
      component: HealthProbe,
      status: HealthStatus,
      latency_ms: z.int().min(0).nullable(),
      detail_code: z.string().nullable(),
      checked_by: z.enum(['cron', 'admin']),
    }),
  ),
);
export const HealthRunBody = z.strictObject({
  probes: z.array(HealthProbe).min(1).max(HEALTH_PROBE_VALUES.length).optional(),
});
export const HealthRunResponse = Success(
  z.object({
    results: z.array(
      z.object({
        probe: HealthProbe,
        status: HealthStatus,
        latency_ms: z.int().min(0).nullable(),
        detail_code: z.string().nullable(),
        checked_at: IsoDateTime,
      }),
    ),
  }),
);
export const AppVersionsQuery = z.strictObject({ range: MetricsRange.default('30d') });
export const AppVersionsResponse = Success(
  z.object({
    versions: z.array(
      z.object({
        platform: z.enum(['ios', 'android']),
        app_version: z.string(),
        installations: z.int().min(0),
        sync_error_rate: z.number().min(0).max(1),
        below_minimum: z.boolean(),
        /** Sentry crash-free rates for the release (0–1); `null` when crash data is unavailable. */
        crash_free_sessions: z.number().min(0).max(1).nullable(),
        crash_free_users: z.number().min(0).max(1).nullable(),
      }),
    ),
    /**
     * Crash data source (BACKOFFICE_PLAN §6.22): `external_credential_required` without the Sentry
     * API credentials (names only), `unavailable` when the Sentry API call failed.
     */
    crash_reporting: z.object({
      status: z.enum(['configured', 'external_credential_required', 'unavailable']),
      credential_keys: z.array(z.string()),
    }),
  }),
);
export const CronHealthResponse = Success(
  z.object({
    schedules: z.array(
      z.object({
        name: z.string(),
        last_run_at: IsoDateTime.nullable(),
        duration_ms: z.int().min(0).nullable(),
        status: z.string().nullable(),
      }),
    ),
    worker_lag_s: z.number().min(0).nullable(),
  }),
);

// ── ADM-19 Admin users ───────────────────────────────────────────────────────
export const AdminUserRow = z.object({
  id: Uuid,
  email: Email,
  role: AdminRole,
  status: z.enum(ADMIN_STATUS_VALUES),
  last_login_at: IsoDateTime.nullable(),
  mfa_enrolled: z.boolean(),
});
export const AdminUsersResponse = Success(z.array(AdminUserRow));
export const AdminInviteBody = z.strictObject({
  email: Email,
  full_name: z.string().trim().min(2).max(120),
  role: AdminRole,
  reason: Reason,
});
export const AdminUserResponse = Success(AdminUserRow);
export const AdminRoleBody = z.strictObject({
  role: AdminRole,
  reason: Reason,
  confirm: z.literal(true),
});
export const AdminStatusBody = SensitiveBody;
export const AdminReasonBody = ReasonBody;
export const AdminResetMfaBody = SensitiveBody;
export const AdminSessionsRevokedResponse = Success(z.object({ ended_sessions: z.int().min(0) }));

// ── ADM-20 Settings ──────────────────────────────────────────────────────────
/** `plan_limits` keys (§4.2, R-22) and their value shapes. */
const Count = z.int().min(0).max(100000);
const Usd = z.number().min(0).max(1000);
export const PLAN_LIMIT_VALUE_SCHEMAS = {
  max_mail_accounts: Count,
  max_calendar_accounts: Count,
  max_calendars: Count,
  ai_daily_budget_units: Count.nullable(),
  ai_soft_cap_usd_day: Usd,
  ai_hard_cap_usd_day: Usd,
  ai_hard_cap_usd_month: Usd,
  ai_routing_profile: z.enum(['balanced', 'lean']),
  ai_briefing_reserve_pct: z.int().min(0).max(100),
  midday_evening: z.boolean(),
  meeting_prep: z.boolean(),
  follow_up_commitments: z.boolean(),
  voice_briefing: z.boolean(),
  memory_search: z.boolean(),
  vip_effects: z.boolean(),
  advanced_planning: z.boolean(),
  capture: z.boolean(),
  android_ni: z.boolean(),
  vip_max: Count,
  priority_rules_max: Count,
  email_analysis_daily: Count,
  reply_drafts_daily: Count,
  assistant_messages_daily: Count,
  assistant_retrieval_days: Count.nullable(),
  transcribe_seconds_daily: Count,
  captures_daily: Count,
  meeting_preps_daily: Count,
  semantic_search_daily: Count,
  backfill_days: z.int().min(1).max(365),
  referral_rewards_per_year: Count,
} as const;
export type PlanLimitKey = keyof typeof PLAN_LIMIT_VALUE_SCHEMAS;
export const PlanLimitKey = z.enum(
  Object.keys(PLAN_LIMIT_VALUE_SCHEMAS) as [PlanLimitKey, ...PlanLimitKey[]],
);
export const PlanLimits = z.object(
  Object.fromEntries(
    Object.entries(PLAN_LIMIT_VALUE_SCHEMAS).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in PlanLimitKey]: z.ZodOptional<(typeof PLAN_LIMIT_VALUE_SCHEMAS)[K]> },
);
export const PlanLimitPatchBody = z
  .strictObject({
    plan: z.enum(['free', 'pro']),
    key: PlanLimitKey,
    value: z.unknown(),
    reason: Reason,
    confirm: z.literal(true),
  })
  .superRefine((body, ctx) => {
    if (!PLAN_LIMIT_VALUE_SCHEMAS[body.key].safeParse(body.value).success) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value_out_of_range' });
    }
    if (body.key === 'ai_daily_budget_units' && body.plan === 'free' && body.value === null) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'free_needs_units' });
    }
  });

/** `app_settings` keys edited in Settings, with their value shapes. */
export const APP_SETTING_VALUE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'app.min_supported_version': z.strictObject({
    ios: z.string().regex(/^\d+\.\d+\.\d+$/),
    android: z.string().regex(/^\d+\.\d+\.\d+$/),
  }),
  'referral.reward_days': z.int().min(1).max(90),
  'referral.max_rewards_per_year': z.int().min(0).max(50),
  'referral.risk_threshold': z.number().min(0).max(1),
  'referral.apply_window_days': z.int().min(1).max(30),
  'google.calendar_write_scope': z.enum([
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.events',
  ]),
  'session.idle_minutes': z.int().min(5).max(30),
  'session.absolute_hours': z.int().min(1).max(12),
  'web.pricing_display': PricingDisplay,
};
export const AppSettingKey = z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/);
export const SettingsResponse = Success(
  z.object({
    plan_limits: z.object({ free: PlanLimits, pro: PlanLimits }),
    app_settings: z.record(z.string(), z.unknown()),
  }),
);
export const ConfigParams = z.strictObject({ key: AppSettingKey });
export const ConfigPatchBody = z.strictObject({
  value: z.unknown(),
  reason: Reason,
  confirm: z.literal(true),
});
/** Validates an `app_settings` value against its per-key schema (unknown keys are refused). */
export function appSettingValueValid(key: string, value: unknown): boolean {
  const schema = APP_SETTING_VALUE_SCHEMAS[key];
  return schema?.safeParse(value).success === true;
}
export const SettingChangedResponse = Success(
  z.object({ key: z.string(), before: z.unknown(), after: z.unknown() }),
);

// ── ADM-21 Global search ─────────────────────────────────────────────────────
export const AdminSearchQuery = z.strictObject({ q: z.string().trim().min(3).max(254) });
export const AdminSearchResponse = Success(
  z.object({
    results: z.array(
      z.object({
        type: z.enum(['user', 'job', 'ticket', 'subscription', 'referral', 'integration']),
        id: z.string(),
        label: z.string(),
        route: z.string().regex(/^\/[A-Za-z0-9/_\-[\].?=&%]*$/),
      }),
    ),
  }),
);
