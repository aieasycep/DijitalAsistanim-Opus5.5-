/**
 * Server-side entitlement gates and plan limits (IMPLEMENTATION_PLAN T-7.02; API_CONTRACTS §4.1,
 * §4.2, §2.6 `ENTITLEMENT_REQUIRED` / `QUOTA_EXCEEDED`; R-22).
 *
 * Every decision is read from the database: `public.check_plan_limit(p_key, p_increment,
 * p_user_id)` resolves the caller's effective plan (`private.plan_of` → `effective_entitlement`,
 * the same function `GET /me/entitlements` reports) and the `plan_limits` value of that plan, so a
 * gate can never disagree with the entitlement the app shows. No limit is hard-coded here.
 *
 * - `requireEntitlement(gate, userId, feature)`: a §4.1 feature key (`midday_briefing`, `capture`,
 *   `mail_accounts`, …). Included features pass; Pro switches and count limits fail with
 *   `402 ENTITLEMENT_REQUIRED {feature, limit_key?, limit?, current?}`.
 * - `checkPlanLimit(gate, userId, key)`: a count key (`max_mail_accounts`, `vip_max`, …) fails with
 *   `ENTITLEMENT_REQUIRED`; a daily quota key (`captures_daily`, …) fails with
 *   `429 QUOTA_EXCEEDED {limit_key, limit, used, resets_at, upgrade_available}` plus `Retry-After`.
 *   Allowed checks return the state for `meta.usage` (`usageDelta`).
 *
 * Both work in `api` (the request's user) and in `worker` (the job's user), with the service
 * client and an explicit user id from verified claims or the job row.
 */
import {
  ENTITLEMENT_FEATURE_GATES,
  type EntitlementFeature,
  type FeatureGate,
  PLAN_COUNT_LIMIT_KEYS,
  PLAN_DAILY_QUOTA_KEYS,
  type PlanCountLimitKey,
  type PlanDailyQuotaKey,
  type PlanFeatureKey,
} from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { AppError, PLAN_LIMIT_FEATURES } from '../../errors.ts';

/** Keys `check_plan_limit` answers: feature switches, counts, daily quotas and AI units. */
export type GateKey =
  PlanFeatureKey | PlanCountLimitKey | PlanDailyQuotaKey | 'ai_daily_budget_units';

/** One `public.check_plan_limit` answer. `limit` null = no cap (Pro fair use). */
export interface PlanLimitState {
  readonly key: string;
  readonly allowed: boolean;
  readonly plan: 'free' | 'pro';
  readonly limit: number | null;
  readonly used: number | null;
  readonly resets_at: string | null;
}

export interface EntitlementGate {
  check(userId: string, key: GateKey, increment?: number): Promise<PlanLimitState>;
}

function toState(key: string, raw: unknown): PlanLimitState {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    key,
    allowed: r.allowed === true,
    plan: r.plan === 'pro' ? 'pro' : 'free',
    limit: typeof r.limit === 'number' ? r.limit : null,
    used: typeof r.used === 'number' ? r.used : null,
    resets_at: typeof r.resets_at === 'string' ? r.resets_at : null,
  };
}

/** `public.check_plan_limit` through PostgREST (service client; the user id is explicit). */
export function supabaseEntitlementGate(client: DbClient): EntitlementGate {
  return {
    async check(userId, key, increment = 1) {
      const raw = await rpc<unknown>(client, DB_FN.checkPlanLimit, {
        p_key: key,
        p_increment: increment,
        p_user_id: userId,
      });
      return toState(key, raw);
    },
  };
}

const COUNT_KEYS: ReadonlySet<string> = new Set(PLAN_COUNT_LIMIT_KEYS);
const DAILY_KEYS: ReadonlySet<string> = new Set([
  ...PLAN_DAILY_QUOTA_KEYS,
  'ai_daily_budget_units',
]);

function entitlementRequired(feature: string | undefined, state: PlanLimitState): AppError {
  const details: Record<string, unknown> = {};
  if (feature !== undefined) details.feature = feature;
  if (COUNT_KEYS.has(state.key)) {
    details.limit_key = state.key;
    if (state.limit !== null) details.limit = state.limit;
    if (state.used !== null) details.current = state.used;
  }
  return new AppError('ENTITLEMENT_REQUIRED', { details });
}

function secondsUntil(iso: string | null, now: Date): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso) - now.getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 1000)) : null;
}

function quotaExceeded(state: PlanLimitState, now: Date): AppError {
  const retryAfter = secondsUntil(state.resets_at, now);
  return new AppError('QUOTA_EXCEEDED', {
    details: {
      limit_key: state.key,
      limit: state.limit,
      used: state.used,
      resets_at: state.resets_at,
      upgrade_available: state.plan === 'free',
    },
    ...(retryAfter === null ? {} : { headers: { 'Retry-After': String(retryAfter) } }),
  });
}

/**
 * Throws `ENTITLEMENT_REQUIRED {feature, …}` unless the user's plan includes `feature`. Count
 * features (`mail_accounts`, `calendars`) ask whether `increment` more fit (default 1).
 */
export async function requireEntitlement(
  gate: EntitlementGate,
  userId: string,
  feature: EntitlementFeature,
  options: { increment?: number } = {},
): Promise<void> {
  const rule: FeatureGate = ENTITLEMENT_FEATURE_GATES[feature];
  if (rule.kind === 'included') return;
  const key = rule.kind === 'plan_feature' ? rule.planKey : rule.limitKey;
  const state = await gate.check(userId, key, options.increment ?? 1);
  if (!state.allowed) throw entitlementRequired(feature, state);
}

/**
 * Checks one count or daily-quota key for `increment` more units. Throws `ENTITLEMENT_REQUIRED`
 * (count keys) or `QUOTA_EXCEEDED` (daily keys); returns the state when allowed.
 */
export async function checkPlanLimit(
  gate: EntitlementGate,
  userId: string,
  key: PlanCountLimitKey | PlanDailyQuotaKey | 'ai_daily_budget_units',
  options: { increment?: number; now?: Date } = {},
): Promise<PlanLimitState> {
  const state = await gate.check(userId, key, options.increment ?? 1);
  if (state.allowed) return state;
  if (DAILY_KEYS.has(key)) throw quotaExceeded(state, options.now ?? new Date());
  throw entitlementRequired(PLAN_LIMIT_FEATURES[key], state);
}

/** `meta.usage` for quota-bearing routes (API_CONTRACTS §4.2). */
export function usageDelta(
  state: PlanLimitState,
  increment = 1,
): {
  limit_key: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  resets_at: string | null;
} {
  const used = (state.used ?? 0) + increment;
  return {
    limit_key: state.key,
    limit: state.limit,
    used,
    remaining: state.limit === null ? null : Math.max(0, state.limit - used),
    resets_at: state.resets_at,
  };
}
