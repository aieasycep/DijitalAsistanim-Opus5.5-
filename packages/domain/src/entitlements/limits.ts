/**
 * `plan_limits` reader (R-22; DATABASE_AND_RLS_PLAN §4.6 `plan_limits`; API_CONTRACTS §4.2).
 *
 * Shape: rows `(plan, key, value jsonb)`. Every limit, budget, routing profile and feature switch
 * is read from these rows; this module holds no limit values. A missing key is an error
 * (`PlanLimitMissingError`), never a silent default, so a gate cannot open or close by accident.
 * Value validation mirrors `private.valid_plan_limit(key, value)`.
 */
import { z } from 'zod';
import { ROUTING_PROFILE_VALUES, type RoutingProfile } from '../enums.ts';
import type { EffectiveEntitlement, EntitlementPlan } from './effective.ts';

export const PLAN_VALUES = ['free', 'pro'] as const satisfies readonly EntitlementPlan[];

/** Count keys checked against current usage (`public.check_plan_limit`, DB triggers). */
export const PLAN_COUNT_LIMIT_KEYS = [
  'max_mail_accounts',
  'max_calendar_accounts',
  'max_calendars',
  'vip_max',
  'priority_rules_max',
] as const;

/** Daily quota keys, reset at local midnight. */
export const PLAN_DAILY_QUOTA_KEYS = [
  'email_analysis_daily',
  'reply_drafts_daily',
  'assistant_messages_daily',
  'transcribe_seconds_daily',
  'captures_daily',
  'meeting_preps_daily',
  'semantic_search_daily',
] as const;

/** Feature switches (M§44). */
export const PLAN_FEATURE_KEYS = [
  'meeting_prep',
  'memory_search',
  'voice_briefing',
  'android_ni',
  'midday_evening',
  'advanced_planning',
  'follow_up_commitments',
  'capture',
  'vip',
] as const;

export const PLAN_USD_KEYS = [
  'ai_soft_cap_usd_day',
  'ai_hard_cap_usd_day',
  'ai_hard_cap_usd_month',
] as const;

/** Integer keys whose JSON value may be `null` (no unit cap / follows the retention window). */
export const PLAN_NULLABLE_INT_KEYS = [
  'ai_daily_budget_units',
  'assistant_retrieval_days',
] as const;

export const PLAN_OTHER_INT_KEYS = ['backfill_days', 'referral_rewards_per_year'] as const;

/** Every canonical key, in the order of the `plan_limits.key` check constraint. */
export const PLAN_LIMIT_KEYS = [
  'max_mail_accounts',
  'max_calendar_accounts',
  'max_calendars',
  'vip_max',
  'priority_rules_max',
  'ai_daily_budget_units',
  'ai_soft_cap_usd_day',
  'ai_hard_cap_usd_day',
  'ai_hard_cap_usd_month',
  'ai_briefing_reserve_ratio',
  'ai_routing_profile',
  'email_analysis_daily',
  'reply_drafts_daily',
  'assistant_messages_daily',
  'assistant_retrieval_days',
  'transcribe_seconds_daily',
  'captures_daily',
  'meeting_preps_daily',
  'semantic_search_daily',
  'backfill_days',
  'referral_rewards_per_year',
  'meeting_prep',
  'memory_search',
  'voice_briefing',
  'android_ni',
  'midday_evening',
  'advanced_planning',
  'follow_up_commitments',
  'capture',
  'vip',
] as const;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];
export type PlanCountLimitKey = (typeof PLAN_COUNT_LIMIT_KEYS)[number];
export type PlanDailyQuotaKey = (typeof PLAN_DAILY_QUOTA_KEYS)[number];
export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];
export type PlanUsdKey = (typeof PLAN_USD_KEYS)[number];
export type PlanNullableIntKey = (typeof PLAN_NULLABLE_INT_KEYS)[number];

export type PlanLimitValue<K extends PlanLimitKey> = K extends PlanFeatureKey
  ? boolean
  : K extends 'ai_routing_profile'
    ? RoutingProfile
    : K extends PlanNullableIntKey
      ? number | null
      : number;

export type PlanLimitSet = { [K in PlanLimitKey]?: PlanLimitValue<K> };
export type PlanLimits = Record<EntitlementPlan, PlanLimitSet>;

export interface PlanLimitRow {
  plan: string;
  key: string;
  value: unknown;
}

const count = z.number().int().min(0);
const usd = z.number().min(0);

function schemaFor(key: PlanLimitKey): z.ZodType {
  if ((PLAN_FEATURE_KEYS as readonly string[]).includes(key)) return z.boolean();
  if (key === 'ai_routing_profile') return z.enum(ROUTING_PROFILE_VALUES);
  if (key === 'ai_briefing_reserve_ratio') return z.number().min(0).max(1);
  if ((PLAN_USD_KEYS as readonly string[]).includes(key)) return usd;
  if ((PLAN_NULLABLE_INT_KEYS as readonly string[]).includes(key)) return count.nullable();
  return count;
}

export function isPlanLimitKey(value: string): value is PlanLimitKey {
  return (PLAN_LIMIT_KEYS as readonly string[]).includes(value);
}

/** `private.valid_plan_limit(key, value)`. */
export function isValidPlanLimitValue(key: PlanLimitKey, value: unknown): boolean {
  return schemaFor(key).safeParse(value).success;
}

export interface PlanLimitIssue {
  plan: string;
  key: string;
  problem: 'unknown_plan' | 'unknown_key' | 'invalid_value' | 'duplicate';
}

export type PlanLimitsParseResult =
  { ok: true; limits: PlanLimits } | { ok: false; issues: PlanLimitIssue[] };

/** Validates `plan_limits` rows into a typed table; any invalid row fails the whole parse. */
export function parsePlanLimitRows(rows: readonly PlanLimitRow[]): PlanLimitsParseResult {
  const limits: Record<EntitlementPlan, Record<string, unknown>> = { free: {}, pro: {} };
  const issues: PlanLimitIssue[] = [];
  for (const row of rows) {
    if (row.plan !== 'free' && row.plan !== 'pro') {
      issues.push({ plan: row.plan, key: row.key, problem: 'unknown_plan' });
      continue;
    }
    if (!isPlanLimitKey(row.key)) {
      issues.push({ plan: row.plan, key: row.key, problem: 'unknown_key' });
      continue;
    }
    if (!isValidPlanLimitValue(row.key, row.value)) {
      issues.push({ plan: row.plan, key: row.key, problem: 'invalid_value' });
      continue;
    }
    if (row.key in limits[row.plan]) {
      issues.push({ plan: row.plan, key: row.key, problem: 'duplicate' });
      continue;
    }
    limits[row.plan][row.key] = row.value;
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, limits };
}

export class PlanLimitMissingError extends Error {
  readonly plan: EntitlementPlan;
  readonly key: PlanLimitKey;
  constructor(plan: EntitlementPlan, key: PlanLimitKey) {
    super(`plan_limits has no value for ${plan}.${key}`);
    this.name = 'PlanLimitMissingError';
    this.plan = plan;
    this.key = key;
  }
}

/** Reads one limit; throws `PlanLimitMissingError` when the row is absent. */
export function readPlanLimit<K extends PlanLimitKey>(
  limits: PlanLimits,
  plan: EntitlementPlan,
  key: K,
): PlanLimitValue<K> {
  const set: PlanLimitSet = limits[plan];
  if (!(key in set)) throw new PlanLimitMissingError(plan, key);
  return set[key] as PlanLimitValue<K>;
}

/** The plan whose limits apply (`private.plan_limit`: pro when effective entitlement is Pro). */
export function planFor(entitlement: Pick<EffectiveEntitlement, 'entitlement'>): EntitlementPlan {
  return entitlement.entitlement;
}

export interface PlanLimitCheck {
  allowed: boolean;
  plan: EntitlementPlan;
  key: PlanCountLimitKey | PlanDailyQuotaKey;
  limit: number;
  used: number;
}

/** Count and daily-quota check (`public.check_plan_limit` without the `resets_at` time). */
export function checkPlanLimit(
  limits: PlanLimits,
  plan: EntitlementPlan,
  key: PlanCountLimitKey | PlanDailyQuotaKey,
  usage: { used: number; increment?: number },
): PlanLimitCheck {
  const limit = readPlanLimit(limits, plan, key);
  const increment = usage.increment ?? 1;
  return { allowed: usage.used + increment <= limit, plan, key, limit, used: usage.used };
}

/** Feature switch for the plan (`check_plan_limit` on a feature key → `{allowed: value}`). */
export function isPlanFeatureEnabled(
  limits: PlanLimits,
  plan: EntitlementPlan,
  key: PlanFeatureKey,
): boolean {
  return readPlanLimit(limits, plan, key);
}

/**
 * Routing profile for AI model selection (UT-ENT-14): the plan's `ai_routing_profile`; a value
 * outside `balanced | lean` resolves to `balanced`.
 */
export function resolveRoutingProfile(value: unknown): RoutingProfile {
  return (ROUTING_PROFILE_VALUES as readonly unknown[]).includes(value)
    ? (value as RoutingProfile)
    : 'balanced';
}

export interface AiBudgetLimits {
  plan: EntitlementPlan;
  /** Visible daily AI units (Free "AI analiz limiti 50/gün"); null = no unit cap (Pro fair use). */
  dailyUnits: number | null;
  softCapUsdDay: number;
  hardCapUsdDay: number;
  hardCapUsdMonth: number;
  softCapMicrosDay: number;
  hardCapMicrosDay: number;
  hardCapMicrosMonth: number;
  briefingReserveRatio: number;
  routingProfile: RoutingProfile;
}

export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/** The inputs of `private.ai_budget_reserve` for a plan. */
export function aiBudgetLimits(limits: PlanLimits, plan: EntitlementPlan): AiBudgetLimits {
  const soft = readPlanLimit(limits, plan, 'ai_soft_cap_usd_day');
  const hardDay = readPlanLimit(limits, plan, 'ai_hard_cap_usd_day');
  const hardMonth = readPlanLimit(limits, plan, 'ai_hard_cap_usd_month');
  return {
    plan,
    dailyUnits: readPlanLimit(limits, plan, 'ai_daily_budget_units'),
    softCapUsdDay: soft,
    hardCapUsdDay: hardDay,
    hardCapUsdMonth: hardMonth,
    softCapMicrosDay: usdToMicros(soft),
    hardCapMicrosDay: usdToMicros(hardDay),
    hardCapMicrosMonth: usdToMicros(hardMonth),
    briefingReserveRatio: readPlanLimit(limits, plan, 'ai_briefing_reserve_ratio'),
    routingProfile: resolveRoutingProfile(readPlanLimit(limits, plan, 'ai_routing_profile')),
  };
}
