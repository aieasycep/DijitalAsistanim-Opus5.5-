/**
 * Entitlement state and usage summary (API-BOOT-02, ADR-11, API_CONTRACTS §4.1–§4.3).
 *
 * `public.effective_entitlement(p_user_id)` decides `is_active` / `source` (store wins when both are
 * active); the store mirror (`subscriptions`) and the active grants (`entitlement_grants`) are listed
 * separately. Usage comes from `public.get_usage_summary()` (RPC-12, local-day quotas). Money is never
 * returned; Pro AI units are "fair use" (`limit: null`).
 */
import type { EntitlementState, UsageSummary } from '@da/validation';
import { addDaysToLocalDate, isValidTimeZone, localDate, startOfLocalDay } from '@da/domain';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import { mapDbError } from '../errors.ts';

export interface EffectiveEntitlementRow {
  readonly is_active: boolean;
  readonly source: 'store' | 'grant' | 'none';
  readonly is_trial: boolean;
  readonly will_renew: boolean;
  readonly store_expires_at: string | null;
  readonly grant_ends_at: string | null;
  readonly active_until: string | null;
}

export interface SubscriptionRow {
  readonly is_active: boolean;
  readonly store: string | null;
  readonly product_id: string | null;
  readonly period_type: string | null;
  readonly will_renew: boolean;
  readonly expires_at: string | null;
  readonly billing_issue_at: string | null;
}

export interface GrantRow {
  readonly id: string;
  readonly source: EntitlementState['grants'][number]['source'];
  readonly starts_at: string;
  readonly ends_at: string;
  readonly revoked_at: string | null;
}

export interface UsageItem {
  readonly key: string;
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly resets_at?: string | null;
}

export interface EntitlementReader {
  effective(userId: string): Promise<EffectiveEntitlementRow>;
  subscription(userId: string): Promise<SubscriptionRow | null>;
  grants(userId: string): Promise<GrantRow[]>;
  usage(): Promise<unknown>;
}

const STORES = new Set(['app_store', 'play_store', 'test_store', 'promotional']);
const PERIODS = new Set(['normal', 'trial', 'intro']);

function iso(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function buildEntitlementState(
  effective: EffectiveEntitlementRow,
  subscription: SubscriptionRow | null,
  grants: readonly GrantRow[],
  now: Date = new Date(),
): EntitlementState {
  const active = grants.filter(
    (g) => g.revoked_at === null && Date.parse(g.ends_at) > now.getTime(),
  );
  return {
    is_active: effective.is_active,
    source: effective.is_active ? effective.source : 'none',
    active_until: iso(effective.active_until),
    store: {
      active: subscription?.is_active === true,
      product_id: subscription?.product_id ?? null,
      store:
        subscription !== null && subscription.store !== null && STORES.has(subscription.store)
          ? (subscription.store as EntitlementState['store']['store'])
          : null,
      period_type:
        subscription !== null && subscription.period_type !== null
          ? PERIODS.has(subscription.period_type)
            ? (subscription.period_type as 'normal' | 'trial' | 'intro')
            : 'normal'
          : null,
      will_renew: subscription?.will_renew === true,
      expires_at: iso(subscription?.expires_at),
      billing_issue:
        subscription?.billing_issue_at !== null && subscription?.billing_issue_at !== undefined,
      management_url: null,
    },
    grants: active.map((g) => ({
      id: g.id,
      source: g.source,
      starts_at: iso(g.starts_at) ?? g.starts_at,
      ends_at: iso(g.ends_at) ?? g.ends_at,
    })),
  };
}

/** Next local midnight in the user's zone (quota reset, §4.2). */
export function nextLocalMidnight(timeZone: string, now: Date = new Date()): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'Europe/Istanbul';
  return startOfLocalDay(addDaysToLocalDate(localDate(now, zone), 1), zone).toISOString();
}

function toItems(raw: unknown): UsageItem[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? Array.isArray((raw as { items?: unknown }).items)
        ? (raw as { items: unknown[] }).items
        : Object.entries(raw as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'object' && v !== null)
            .map(([key, v]) => ({ key, ...(v as object) }))
      : [];
  const items: UsageItem[] = [];
  for (const entry of list) {
    const e = entry as {
      key?: unknown;
      limit?: unknown;
      used?: unknown;
      remaining?: unknown;
      resets_at?: unknown;
    };
    if (typeof e.key !== 'string') continue;
    const limit = typeof e.limit === 'number' ? Math.trunc(e.limit) : null;
    const used = typeof e.used === 'number' ? Math.max(0, Math.trunc(e.used)) : 0;
    const remaining =
      typeof e.remaining === 'number'
        ? Math.max(0, Math.trunc(e.remaining))
        : limit === null
          ? null
          : Math.max(0, limit - used);
    items.push({
      key: e.key,
      limit,
      used,
      remaining,
      resets_at: typeof e.resets_at === 'string' ? e.resets_at : null,
    });
  }
  return items;
}

/** Maps RPC-12 rows to the `UsageSummary` view (money is never exposed). */
export function buildUsageSummary(
  raw: unknown,
  plan: 'free' | 'pro',
  timeZone: string,
  now: Date = new Date(),
): UsageSummary {
  const items = toItems(raw);
  const units = items.find((i) => i.key === 'ai_daily_budget_units');
  const resetsAt =
    iso(items.find((i) => i.resets_at !== null && i.resets_at !== undefined)?.resets_at) ??
    nextLocalMidnight(timeZone, now);
  const limits: UsageSummary['limits'] = {};
  for (const item of items) {
    if (item.key === 'ai_daily_budget_units' || item.limit === null) continue;
    limits[item.key] = {
      limit: item.limit,
      used: item.used,
      remaining: item.remaining ?? Math.max(0, item.limit - item.used),
    };
  }
  const unitLimit = plan === 'pro' ? null : (units?.limit ?? null);
  const unitRemaining = unitLimit === null ? null : Math.max(0, unitLimit - (units?.used ?? 0));
  const ai = (raw as { ai_budget?: { state?: unknown; level?: unknown } } | null)?.ai_budget;
  const state =
    ai?.state === 'soft_limited' || ai?.state === 'exhausted'
      ? ai.state
      : unitRemaining === 0
        ? 'exhausted'
        : 'ok';
  const level =
    ai?.level === 'L1' || ai?.level === 'L2' || ai?.level === 'L3'
      ? ai.level
      : state === 'exhausted'
        ? 'L2'
        : 'L0';
  return {
    plan,
    resets_at: resetsAt,
    limits,
    ai_budget: { state, level },
    ai_units: { limit: unitLimit, used: units?.used ?? 0, remaining: unitRemaining },
  };
}

// ── supabase-backed reader (the caller's RLS client) ─────────────────────────

export function supabaseEntitlementReader(user: DbClient): EntitlementReader {
  return {
    async effective(userId) {
      const rows = await rpc<EffectiveEntitlementRow[] | EffectiveEntitlementRow | null>(
        user,
        DB_FN.effectiveEntitlement,
        {
          p_user_id: userId,
        },
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      return (
        row ?? {
          is_active: false,
          source: 'none',
          is_trial: false,
          will_renew: false,
          store_expires_at: null,
          grant_ends_at: null,
          active_until: null,
        }
      );
    },
    async subscription(userId) {
      const { data, error } = await user
        .from('subscriptions')
        .select('is_active,store,product_id,period_type,will_renew,expires_at,billing_issue_at')
        .eq('user_id', userId)
        .eq('entitlement', 'pro')
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as SubscriptionRow | null) ?? null;
    },
    async grants(userId) {
      const { data, error } = await user
        .from('entitlement_grants')
        .select('id,source,starts_at,ends_at,revoked_at')
        .eq('user_id', userId)
        .is('revoked_at', null)
        .order('ends_at', { ascending: false })
        .limit(50);
      if (error !== null) throw mapDbError(error);
      return (data ?? []) as GrantRow[];
    },
    usage() {
      return rpc<unknown>(user, DB_FN.getUsageSummary, {});
    },
  };
}
