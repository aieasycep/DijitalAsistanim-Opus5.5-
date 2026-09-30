/**
 * Route-level Pro gates for `api` (IMPLEMENTATION_PLAN T-7.02; API_CONTRACTS §4.1 "Server
 * enforcement points").
 *
 * `PRO_ROUTE_FEATURES` lists every `api` route whose contract says **Plan: Pro (<feature>)** with no
 * condition. `routeEntitlementGate` runs inside `kit.chain(...)` (after auth, the account gate and
 * the rate limit) and checks the feature of the matched route key, so a Pro route is gated server
 * side as soon as it is mounted with `mountRoute`, whoever implements it.
 *
 * Routes whose gate depends on the request (API-INT-01/02/05/06 count limits, API-APR-01
 * `commitment_create` / planning origins, API-APR-03 downgrade rule, API-PLAN-01 range, API-SRCH-01
 * `mode=answer`, API-BRF-04 kind) call `requireEntitlement` / `checkPlanLimit` in their handler,
 * and API-CAP-05 (discard) stays open to owners after a downgrade.
 */
import type { MiddlewareHandler } from 'hono';
import type { EntitlementFeature, PlanCountLimitKey, PlanDailyQuotaKey } from '@da/domain';
import { AppError } from '../../errors.ts';
import type { AppEnv, UserAuth } from '../../http/context.ts';
import { checkPlanLimit, type EntitlementGate, requireEntitlement } from './gate.ts';

export const PRO_ROUTE_FEATURES = {
  'POST /followups/:threadId/draft': 'follow_up',
  'POST /plan/proposals': 'advanced_planning',
  'POST /plan/conflicts/:insightId/options': 'advanced_planning',
  'POST /plan/conflicts/:insightId/resolve': 'advanced_planning',
  'POST /meetings/:eventId/prep': 'meeting_prep',
  'POST /meetings/:eventId/notes': 'meeting_prep',
  'POST /meetings/:eventId/post': 'commitments',
  'POST /meetings/:eventId/prep/audio': 'meeting_prep',
  'POST /captures/upload-url': 'capture',
  'POST /captures': 'capture',
  'POST /captures/:id/analyze': 'capture',
  'POST /captures/:id/actions': 'capture',
  'POST /briefings/:id/audio': 'voice_briefing',
  'POST /briefings/:id/evening-ready': 'evening_briefing',
  'POST /android-notifications/signals': 'android_ni',
} as const satisfies Readonly<Record<string, EntitlementFeature>>;

export type ProRouteKey = keyof typeof PRO_ROUTE_FEATURES;

/** The Pro feature a route key requires, or null for routes without an unconditional gate. */
export function proFeatureForRoute(routeKey: string | undefined): EntitlementFeature | null {
  if (routeKey === undefined) return null;
  return (PRO_ROUTE_FEATURES as Readonly<Record<string, EntitlementFeature>>)[routeKey] ?? null;
}

export type GateResolver = (auth: UserAuth) => EntitlementGate;

function authOf(c: { get(key: 'auth'): UserAuth | undefined }): UserAuth {
  const auth = c.get('auth');
  if (auth === undefined)
    throw new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } });
  return auth;
}

/** Checks `PRO_ROUTE_FEATURES[routeKey]` for the caller; a no-op on every other route. */
export function routeEntitlementGate(resolve: GateResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const feature = proFeatureForRoute(c.get('routeKey'));
    if (feature !== null) {
      const auth = authOf(c);
      await requireEntitlement(resolve(auth), auth.userId, feature);
    }
    await next();
  };
}

/** Explicit per-route gate (`...kit.chain(...), entitlementRequired('vip', resolve)`). */
export function entitlementRequired(
  feature: EntitlementFeature,
  resolve: GateResolver,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = authOf(c);
    await requireEntitlement(resolve(auth), auth.userId, feature);
    await next();
  };
}

/** Explicit per-route count / daily quota check before the handler runs. */
export function planLimitRequired(
  key: PlanCountLimitKey | PlanDailyQuotaKey | 'ai_daily_budget_units',
  resolve: GateResolver,
  now: () => Date = () => new Date(),
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = authOf(c);
    await checkPlanLimit(resolve(auth), auth.userId, key, { now: now() });
    await next();
  };
}
