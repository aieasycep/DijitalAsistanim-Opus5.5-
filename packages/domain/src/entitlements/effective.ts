/**
 * Effective entitlement (M§43; plan §15; ADR-11; DATABASE_AND_RLS_PLAN §6.5
 * `public.effective_entitlement`; TEST_PLAN §2.9 UT-ENT-01..08). The SQL function implements the
 * same algorithm; the shared vectors in `test/vectors/entitlement.json` keep the two equal.
 *
 * Algorithm (all instants compared in UTC; `now` is explicit):
 *
 * 1. **Store** (RevenueCat mirror `subscriptions`, entitlement `pro`) is active when
 *    - the row exists and `is_active` is true (the REST v2 snapshot is the truth), and
 *    - `status` is not `none`, `expired`, `refunded` or `paused`, and
 *    - the row is not a sandbox row that the caller ignores (production without an allow-listed
 *      tester, JOB-24), and
 *    - its end is after `now`. The end is `expires_at`, extended to `grace_expires_at` while
 *      `status` is `grace_period` or `billing_issue`; a null end (non-expiring) never lapses.
 * 2. **Grants** (`entitlement_grants`) count when `revoked_at` is null. They are active when one
 *    covers `now` (`starts_at <= now < ends_at`). Grants stack without overlap
 *    (`stackGrantWindow`), so the grant end is the end of the contiguous chain starting at `now`.
 * 3. `entitlement` is `pro` when either is active. `source` is `store` when the store is active
 *    (store wins when both are), else `grant`, else null (SQL: `none`).
 * 4. `expires_at` (SQL `active_until`) is the end of the contiguous Pro coverage from `now` across
 *    the store window and all grants, or null when a non-expiring store entitlement is active or
 *    the user is Free.
 */
import type { GrantSource, SubscriptionStatus } from '../enums.ts';

export type EntitlementPlan = 'free' | 'pro';
export type EntitlementSource = 'store' | 'grant';

/** The `subscriptions` mirror columns the entitlement needs (DATABASE_AND_RLS_PLAN §4.6). */
export interface SubscriptionMirror {
  is_active: boolean;
  status: SubscriptionStatus;
  environment?: 'sandbox' | 'production' | null;
  period_type?: 'normal' | 'trial' | 'intro' | 'prepaid' | null;
  expires_at: string | null;
  grace_expires_at?: string | null;
  will_renew: boolean;
}

/** The `entitlement_grants` columns the entitlement needs. */
export interface EntitlementGrantRow {
  id?: string;
  source: GrantSource;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
}

export interface EffectiveEntitlementInput {
  subscription: SubscriptionMirror | null;
  grants: readonly EntitlementGrantRow[];
  now: Date;
  /** True in production for users who are not allow-listed testers (JOB-24 step 2). */
  ignoreSandboxStore?: boolean;
}

export interface EffectiveEntitlement {
  entitlement: EntitlementPlan;
  source: EntitlementSource | null;
  /** End of the contiguous Pro coverage (SQL `active_until`). */
  expires_at: string | null;
  is_trial: boolean;
  will_renew: boolean;
  /** Store end while the store is active (null when inactive or non-expiring). */
  store_expires_at: string | null;
  /** End of the active grant chain, or null when no grant covers `now`. */
  grant_ends_at: string | null;
}

const INACTIVE_STORE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'none',
  'expired',
  'refunded',
  'paused',
]);
const GRACE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'grace_period',
  'billing_issue',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(iso: string, field: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`${field} is not a valid timestamp: ${iso}`);
  return ms;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

interface Interval {
  start: number;
  end: number;
}

/** Store window end (ms), `Infinity` for non-expiring, or null when the store is not active. */
function storeEnd(input: EffectiveEntitlementInput): number | null {
  const sub = input.subscription;
  if (sub === null || !sub.is_active || INACTIVE_STORE_STATUSES.has(sub.status)) return null;
  if (input.ignoreSandboxStore === true && sub.environment === 'sandbox') return null;
  let end = sub.expires_at === null ? Infinity : toMs(sub.expires_at, 'expires_at');
  const grace = sub.grace_expires_at ?? null;
  if (GRACE_STATUSES.has(sub.status) && grace !== null) {
    end = Math.max(end, toMs(grace, 'grace_expires_at'));
  }
  return end > input.now.getTime() ? end : null;
}

function liveGrantIntervals(grants: readonly EntitlementGrantRow[]): Interval[] {
  return grants
    .filter((grant) => grant.revoked_at === null)
    .map((grant) => ({
      start: toMs(grant.starts_at, 'starts_at'),
      end: toMs(grant.ends_at, 'ends_at'),
    }))
    .filter((interval) => interval.end > interval.start);
}

/** End of the contiguous coverage that contains `now`, or null when nothing covers `now`. */
function coverageEnd(intervals: readonly Interval[], now: number): number | null {
  let end: number | null = null;
  for (const interval of intervals) {
    if (interval.start <= now && now < interval.end)
      end = Math.max(end ?? interval.end, interval.end);
  }
  if (end === null) return null;
  let extended = true;
  while (extended && end !== Infinity) {
    extended = false;
    for (const interval of intervals) {
      if (interval.start <= end && interval.end > end) {
        end = interval.end;
        extended = true;
      }
    }
  }
  return end;
}

export function effectiveEntitlement(input: EffectiveEntitlementInput): EffectiveEntitlement {
  const now = input.now.getTime();
  const store = storeEnd(input);
  const grants = liveGrantIntervals(input.grants);
  const grantEnd = coverageEnd(grants, now);
  const storeActive = store !== null;
  if (!storeActive && grantEnd === null) {
    return {
      entitlement: 'free',
      source: null,
      expires_at: null,
      is_trial: false,
      will_renew: false,
      store_expires_at: null,
      grant_ends_at: null,
    };
  }
  const intervals = storeActive ? [{ start: -Infinity, end: store }, ...grants] : grants;
  const until = coverageEnd(intervals, now);
  const sub = input.subscription;
  return {
    entitlement: 'pro',
    source: storeActive ? 'store' : 'grant',
    expires_at: until === null || until === Infinity ? null : toIso(until),
    is_trial:
      storeActive && sub !== null && (sub.status === 'trial' || sub.period_type === 'trial'),
    will_renew: storeActive && sub?.will_renew === true,
    store_expires_at: store === null || store === Infinity ? null : toIso(store),
    grant_ends_at: grantEnd === null ? null : toIso(grantEnd),
  };
}

/** SQL / API spelling of the source (`EntitlementState.source`). */
export function entitlementSourceLabel(
  entitlement: Pick<EffectiveEntitlement, 'source'>,
): 'store' | 'grant' | 'none' {
  return entitlement.source ?? 'none';
}

export function isPro(entitlement: Pick<EffectiveEntitlement, 'entitlement'>): boolean {
  return entitlement.entitlement === 'pro';
}

// ---------------------------------------------------------------------------------------------
// Grant stacking and duration rules (`private.grant_entitlement`; entitlement_grants checks)

/**
 * Window for a new grant: it starts at `now` or at the latest end of the user's unrevoked grants
 * that have not ended yet, whichever is later, and lasts `days` × 24 h. Consecutive grants
 * therefore extend Pro without overlapping (UT-REF-10).
 */
export function stackGrantWindow(input: {
  grants: readonly EntitlementGrantRow[];
  now: Date;
  days: number;
}): { starts_at: string; ends_at: string } {
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new RangeError('days must be a positive integer');
  }
  const now = input.now.getTime();
  let start = now;
  for (const interval of liveGrantIntervals(input.grants)) {
    if (interval.end > now) start = Math.max(start, interval.end);
  }
  return { starts_at: toIso(start), ends_at: toIso(start + input.days * DAY_MS) };
}

export const ADMIN_GRANT_DURATION_DAYS = [1, 7, 14, 30] as const;
export const REFERRAL_GRANT_MAX_DAYS = 60;

/** The `entitlement_grants.duration_days` check constraint. */
export function isValidGrantDuration(source: GrantSource, days: number): boolean {
  if (!Number.isInteger(days)) return false;
  if (source === 'referral_referrer' || source === 'referral_referee') {
    return days >= 1 && days <= REFERRAL_GRANT_MAX_DAYS;
  }
  return (ADMIN_GRANT_DURATION_DAYS as readonly number[]).includes(days);
}
