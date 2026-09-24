/**
 * The entitlement as the screens describe it (M-SET-01 identity line, M-SUB-01 hero), derived from
 * `EntitlementState` (`GET /me/entitlements` / bootstrap; `effective_entitlement()` on the server,
 * which stays authoritative).
 */
import type { EntitlementState } from '@da/validation/api/common';

export type HeroKind = 'free' | 'trial' | 'active' | 'billing_issue' | 'grant';
export type PlanPeriod = 'annual' | 'monthly';

/** `da_pro_annual` / `da_pro_monthly` (RevenueCat packages `$rc_annual` / `$rc_monthly`). */
export function periodOf(productId: string | null): PlanPeriod | null {
  if (productId === null) return null;
  if (/annual|year/i.test(productId)) return 'annual';
  if (/month/i.test(productId)) return 'monthly';
  return null;
}

export function heroKindOf(entitlement: EntitlementState): HeroKind {
  const store = entitlement.store;
  if (store.active && store.billing_issue) return 'billing_issue';
  if (store.active && store.period_type === 'trial') return 'trial';
  if (store.active) return 'active';
  if (entitlement.is_active && entitlement.grants.length > 0) return 'grant';
  return 'free';
}

/** The `subscription_opened.state` analytics value. */
export function analyticsStateOf(
  entitlement: EntitlementState,
): 'free' | 'trial' | 'active' | 'billing_issue' | 'cancelled' | 'grant' {
  const kind = heroKindOf(entitlement);
  if (kind === 'active' && !entitlement.store.will_renew) return 'cancelled';
  return kind;
}

/** Whole days until `iso` (at least 0). */
export function daysUntil(iso: string | null, now: Date): number {
  if (iso === null) return 0;
  const ms = Date.parse(iso) - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : 0;
}

/** The grant that ends last (stacked grants run back to back). */
export function latestGrant(
  entitlement: EntitlementState,
): EntitlementState['grants'][number] | null {
  let best: EntitlementState['grants'][number] | null = null;
  for (const grant of entitlement.grants) {
    if (best === null || grant.ends_at > best.ends_at) best = grant;
  }
  return best;
}

/** Whether the store subscription (not a grant) is what the user manages in the store. */
export function hasStoreSubscription(entitlement: EntitlementState): boolean {
  return entitlement.store.active && entitlement.store.store !== 'promotional';
}
