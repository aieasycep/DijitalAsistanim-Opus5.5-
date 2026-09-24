/**
 * Static configuration shared by the Edge Functions: the function set, transport limits
 * (API_CONTRACTS §2.10), rate-limit classes (§2.9) and runtime constants. Values that operators
 * tune at runtime live in the database (`plan_limits`, `app_settings`, `feature_flags`,
 * `ai_model_config`), never here.
 */

/** The canonical function set (MASTER_PLAN ADR-04, API_CONTRACTS §1). */
export const FUNCTION_NAMES = [
  'api',
  'oauth',
  'webhooks-google',
  'webhooks-microsoft',
  'webhooks-revenuecat',
  'worker',
  'admin-api',
  'public-api',
  'health',
] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];

/** Contract date served by this build (`X-DA-Api-Version`, API_CONTRACTS §2.3). */
export const API_CONTRACT_VERSION = '2026-09-23';
/** The previous contract date is still accepted (§2.3). */
export const SUPPORTED_API_VERSIONS: readonly string[] = [API_CONTRACT_VERSION];

/** Hard ceiling on any request body, per function (T-3.02). Route limits below are tighter. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** Default JSON body limit (API_CONTRACTS §2.10). */
export const DEFAULT_JSON_BODY_BYTES = 256 * 1024;
/** Per-route body limits ("METHOD /path" of the route registries). */
export const ROUTE_BODY_BYTES: Readonly<Record<string, number>> = {
  'POST /analytics/events': 64 * 1024,
  'POST /integrations/device-calendar/snapshot': 1024 * 1024,
  'POST /android-notifications/signals': 128 * 1024,
};

/** `X-Correlation-Id` accepted from callers (§2.2); anything else is replaced. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Rate-limit classes (API_CONTRACTS §2.9): `limit` requests per `windowSeconds`. */
export interface RateLimitClass {
  readonly limit: number;
  readonly windowSeconds: number;
  /** Who the counter belongs to. */
  readonly subject: 'user' | 'installation' | 'ip';
}

export const RATE_LIMITS = {
  api_default: { limit: 120, windowSeconds: 60, subject: 'user' },
  devices_register: { limit: 30, windowSeconds: 3600, subject: 'user' },
  // Business (T-7.01, T-7.03): referral apply user 5/h + IP hash 20/h; purchases sync 6/60 s.
  referral_apply: { limit: 5, windowSeconds: 3600, subject: 'user' },
  referral_apply_ip: { limit: 20, windowSeconds: 3600, subject: 'ip' },
  purchases_sync: { limit: 6, windowSeconds: 60, subject: 'user' },
  support_ticket: { limit: 5, windowSeconds: 3600, subject: 'user' },
  feedback: { limit: 10, windowSeconds: 3600, subject: 'user' },
  analytics: { limit: 60, windowSeconds: 60, subject: 'installation' },
  approvals_mutate: { limit: 60, windowSeconds: 60, subject: 'user' },
  device_execution: { limit: 60, windowSeconds: 60, subject: 'installation' },
  notifications_test: { limit: 3, windowSeconds: 3600, subject: 'user' },
  widgets_snapshot: { limit: 60, windowSeconds: 3600, subject: 'installation' },
  // Integrations (API-INT-01/02 start / upgrade, API-INT-07 completion, API-INT-04 per account).
  integrations_start: { limit: 10, windowSeconds: 60, subject: 'user' },
  integrations_start_hourly: { limit: 30, windowSeconds: 3600, subject: 'user' },
  integrations_complete: { limit: 20, windowSeconds: 600, subject: 'user' },
  integrations_sync: { limit: 1, windowSeconds: 60, subject: 'user' },
  mail_original: { limit: 60, windowSeconds: 60, subject: 'user' },
  // Privacy (API-PRV-01…04): export / delete-history / delete-account 3 per 24 h each; download 20/h.
  privacy_export: { limit: 3, windowSeconds: 86_400, subject: 'user' },
  privacy_delete_history: { limit: 3, windowSeconds: 86_400, subject: 'user' },
  privacy_delete_account: { limit: 3, windowSeconds: 86_400, subject: 'user' },
  privacy_export_download: { limit: 20, windowSeconds: 3600, subject: 'user' },
  search: { limit: 30, windowSeconds: 60, subject: 'user' },
  thread_summary: { limit: 20, windowSeconds: 60, subject: 'user' },
  /** API-BRF-04: 1 per 10 min per briefing (enforced with the briefing id as the subject). */
  briefing_retry: { limit: 1, windowSeconds: 600, subject: 'user' },
} as const satisfies Record<string, RateLimitClass>;
export type RateLimitClassName = keyof typeof RATE_LIMITS;

/** Jobs runner (IMPLEMENTATION_PLAN T-3.06, API_CONTRACTS §11). */
export const JOBS = {
  leaseSeconds: 120,
  /** No new claims after this many ms of a run (the lease minus a 10 s safety margin). */
  stopClaimingAfterMs: 110_000,
  claimBatch: 5,
  defaultMaxJobs: 25,
  defaultTimeoutMs: 60_000,
  backoffBaseSeconds: 30,
  backoffCapSeconds: 3600,
  /** A provider `Retry-After` up to this many seconds overrides the computed delay. */
  retryAfterOverrideMaxSeconds: 3600,
  heartbeatEveryMs: 60_000,
} as const;

/** Outbound calls (§2.10). */
export const OUTBOUND = {
  providerTimeoutMs: 10_000,
  healthProbeTimeoutMs: 4_000,
  workerPokeTimeoutMs: 2_000,
} as const;

/** `app_settings` keys read by the Edge Functions. */
export const APP_SETTING_KEYS = {
  minSupportedVersion: 'app.min_supported_version',
  referralRewardDays: 'referral.reward_days',
} as const;

/** Documented defaults when an `app_settings` row is absent (API_CONTRACTS §2.3). */
export const APP_SETTING_DEFAULTS = {
  minSupportedVersion: { ios: '1.0.0', android: '1.0.0' },
  referralRewardDays: 14,
} as const;

/** Client-side approval undo delay (R-06). */
export const UNDO_WINDOW_SECONDS = 5 as const;
