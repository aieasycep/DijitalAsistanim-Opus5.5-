/**
 * ADM-01 dashboard and metrics (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.1, §7; T-10.05): read-only
 * aggregates over the metric population (internal and demo users excluded) through
 * `dashboard_metrics`, `dashboard_series`, `metrics_ops`, `metrics_product` and `security_events`.
 * Each KPI carries its delta against the previous equal window ("+12% önceki döneme göre"):
 * `(current − previous) / previous`, `null` when there is no previous value. Ratios with a zero
 * denominator are `null` in SQL and render as `0` in the non-nullable contract fields.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { arr, count, type Json, num, numericMembers, obj, str } from '../lib/map.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

/** Relative change against the previous window, rounded to 4 decimals. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 10000;
}

function kpiValues(block: Json, extra: Json): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of A.DASHBOARD_METRIC_KEYS) out[key] = num(block[key]);
  if (out.ai_cost_per_active_user === null)
    out.ai_cost_per_active_user = num(extra.ai_cost_per_active_user);
  return out;
}

function costPerActive(block: Json): number | null {
  const active = num(block.active_users);
  const cost = num(block.ai_cost_usd);
  if (active === null || cost === null || active <= 0) return null;
  return Math.round((cost / active) * 10000) / 10000;
}

async function metrics(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.DashboardMetricsQuery>;
  const out = obj(await ctx.db.call('dashboard_metrics', { p_range: query.range }));
  const current = obj(out.value);
  const previous = obj(out.prev_value);
  const cur = kpiValues(current, { ai_cost_per_active_user: out.ai_cost_per_active_user });
  const prev = kpiValues(previous, { ai_cost_per_active_user: costPerActive(previous) });
  const data: Record<string, { value: number; delta: number | null }> = {};
  for (const key of A.DASHBOARD_METRIC_KEYS) {
    data[key] = { value: cur[key] ?? 0, delta: delta(cur[key] ?? null, prev[key] ?? null) };
  }
  return { data };
}

async function charts(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.DashboardChartsQuery>;
  const out = obj(
    await ctx.db.call('dashboard_series', { p_metric: query.series, p_range: query.range }),
  );
  return {
    data: {
      points: arr(out.points).map((p) => ({
        t: p.t,
        value: num(p.value) ?? 0,
        ...(p.breakdown !== null && typeof p.breakdown === 'object'
          ? { breakdown: numericMembers(p.breakdown) }
          : {}),
      })),
    },
  };
}

async function opsMetrics(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.RangeQuery>;
  const out = obj(await ctx.db.call('metrics_ops', { p_range: query.range }));
  return {
    data: {
      range: query.range,
      groups: {
        kpis: numericMembers(out.kpis),
        decision_tiers: numericMembers(out.decision_tiers),
        jobs: numericMembers(out.jobs),
        notifications: numericMembers(out.notifications),
      },
    },
  };
}

async function productMetrics(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.RangeQuery>;
  const out = obj(await ctx.db.call('metrics_product', { p_range: query.range }));
  const groups: Record<string, Record<string, number>> = {
    summary: numericMembers({ active_users: out.active_users }),
    feature_usage_users: {},
    feature_usage_share: {},
    referrals: numericMembers(out.referrals),
  };
  for (const [event, value] of Object.entries(obj(out.feature_usage))) {
    const v = obj(value);
    const users = num(v.users);
    const share = num(v.share);
    if (users !== null) (groups.feature_usage_users as Record<string, number>)[event] = users;
    if (share !== null) (groups.feature_usage_share as Record<string, number>)[event] = share;
  }
  for (const [actionType, value] of Object.entries(obj(out.approvals))) {
    groups[`approvals.${actionType}`] = numericMembers(value);
  }
  return { data: { range: query.range, groups } };
}

async function securityEvents(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.RangeQuery>;
  const out = obj(await ctx.db.call('security_events', { p_range: query.range }));
  return {
    data: {
      range: query.range,
      login_failures: count(out.login_failures),
      lockouts: count(out.lockouts),
      recovery_codes_used: count(out.recovery_codes_used),
      permission_denials: count(out.permission_denials),
      webhook_signature_failures: count(out.webhook_signature_failures),
      by_admin: arr(out.by_admin)
        .filter((r) => str(r.admin_id) !== null)
        .map((r) => ({ admin_id: r.admin_id, count: count(r.count) })),
    },
  };
}

export const dashboardRoutes = defineRoutes({
  'GET /dashboard/metrics': { rate: 'R', handle: metrics },
  'GET /dashboard/charts': { rate: 'R', handle: charts },
  'GET /metrics/ops': { rate: 'R', handle: opsMetrics },
  'GET /metrics/product': { rate: 'R', handle: productMetrics },
  'GET /security-events': { rate: 'R', handle: securityEvents },
});
