/**
 * Pro gate matrix (M§44; plan §15; API_CONTRACTS §4.1; TEST_PLAN UT-ENT-09/10).
 *
 * Each capability names the `plan_limits` row that decides it, so whether a plan may use a
 * feature is always read from `plan_limits` (R-22) and never hard-coded:
 *
 * - Free and Pro (M§15 Free list): morning briefing, basic Today, basic important mail, weekly
 *   review (the weekly review is additionally controlled by flag `feature.weekly_review`).
 * - Count-limited: mail accounts (`max_mail_accounts`) and selected calendars (`max_calendars`);
 *   Free is seeded with 1 and 1.
 * - Pro-only switches (M§15 Pro list), each a boolean `plan_limits` feature key.
 *
 * Server gates run in `api` and `worker`; a failed check is `ENTITLEMENT_REQUIRED {feature, …}`.
 */
import type { EntitlementPlan } from './effective.ts';
import {
  checkPlanLimit,
  isPlanFeatureEnabled,
  type PlanCountLimitKey,
  type PlanFeatureKey,
  type PlanLimits,
} from './limits.ts';

export type FeatureGate =
  | { kind: 'included' }
  | { kind: 'count'; limitKey: Extract<PlanCountLimitKey, 'max_mail_accounts' | 'max_calendars'> }
  | { kind: 'plan_feature'; planKey: PlanFeatureKey };

/** Feature keys as used in `ENTITLEMENT_REQUIRED {feature}` and `paywall?source=` (API §4.1). */
export const ENTITLEMENT_FEATURE_GATES = {
  morning_briefing: { kind: 'included' },
  basic_today: { kind: 'included' },
  important_mail: { kind: 'included' },
  weekly_review: { kind: 'included' },
  mail_accounts: { kind: 'count', limitKey: 'max_mail_accounts' },
  calendars: { kind: 'count', limitKey: 'max_calendars' },
  midday_briefing: { kind: 'plan_feature', planKey: 'midday_evening' },
  evening_briefing: { kind: 'plan_feature', planKey: 'midday_evening' },
  meeting_prep: { kind: 'plan_feature', planKey: 'meeting_prep' },
  follow_up: { kind: 'plan_feature', planKey: 'follow_up_commitments' },
  commitments: { kind: 'plan_feature', planKey: 'follow_up_commitments' },
  voice_briefing: { kind: 'plan_feature', planKey: 'voice_briefing' },
  ai_memory: { kind: 'plan_feature', planKey: 'memory_search' },
  vip: { kind: 'plan_feature', planKey: 'vip' },
  advanced_planning: { kind: 'plan_feature', planKey: 'advanced_planning' },
  capture: { kind: 'plan_feature', planKey: 'capture' },
  android_ni: { kind: 'plan_feature', planKey: 'android_ni' },
} as const satisfies Record<string, FeatureGate>;

export type EntitlementFeature = keyof typeof ENTITLEMENT_FEATURE_GATES;

export const ENTITLEMENT_FEATURES = Object.keys(
  ENTITLEMENT_FEATURE_GATES,
) as readonly EntitlementFeature[];

/** M§15 Pro list: capabilities decided by a Pro-only feature switch. */
export const PRO_FEATURES: readonly EntitlementFeature[] = ENTITLEMENT_FEATURES.filter(
  (feature) => ENTITLEMENT_FEATURE_GATES[feature].kind === 'plan_feature',
);

/** M§15 Free list: included capabilities plus the count-limited account and calendar. */
export const FREE_FEATURES: readonly EntitlementFeature[] = ENTITLEMENT_FEATURES.filter(
  (feature) => ENTITLEMENT_FEATURE_GATES[feature].kind !== 'plan_feature',
);

export interface EntitlementRequiredDetails {
  feature: EntitlementFeature;
  limit_key?: PlanCountLimitKey;
  limit?: number;
  current?: number;
}

export type FeatureCheck =
  | { allowed: true }
  | { allowed: false; code: 'ENTITLEMENT_REQUIRED'; details: EntitlementRequiredDetails };

/**
 * Server-side gate for one capability. Count features need `current` (e.g. active mail accounts
 * already connected); the check asks whether one more fits.
 */
export function checkFeature(
  feature: EntitlementFeature,
  context: { plan: EntitlementPlan; limits: PlanLimits; current?: number },
): FeatureCheck {
  const gate: FeatureGate = ENTITLEMENT_FEATURE_GATES[feature];
  if (gate.kind === 'included') return { allowed: true };
  if (gate.kind === 'plan_feature') {
    return isPlanFeatureEnabled(context.limits, context.plan, gate.planKey)
      ? { allowed: true }
      : { allowed: false, code: 'ENTITLEMENT_REQUIRED', details: { feature } };
  }
  const current = context.current ?? 0;
  const result = checkPlanLimit(context.limits, context.plan, gate.limitKey, { used: current });
  return result.allowed
    ? { allowed: true }
    : {
        allowed: false,
        code: 'ENTITLEMENT_REQUIRED',
        details: { feature, limit_key: gate.limitKey, limit: result.limit, current },
      };
}

export function isFeatureAllowed(
  feature: EntitlementFeature,
  context: { plan: EntitlementPlan; limits: PlanLimits; current?: number },
): boolean {
  return checkFeature(feature, context).allowed;
}
