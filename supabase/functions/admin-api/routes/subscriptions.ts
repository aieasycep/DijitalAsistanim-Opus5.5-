/**
 * ADM-11 subscriptions and ADM-12 referrals (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.13–§6.15, §7.5;
 * T-10.11). Store entitlements and grants are reported separately; revenue fields need
 * `metrics.revenue.read` (absent, not null, without it); billing events are sanitised in SQL (never
 * `subscriber_attributes`, `aliases` or the raw payload). A resync queues `billing_sync` (JOB-24);
 * referral approval runs the idempotent reward step.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError, mapDbError } from '../../_shared/errors.ts';
import { filterValue, listArgs, paged, qValue } from '../lib/list.ts';
import {
  arr,
  count,
  type Json,
  num,
  obj,
  ratio,
  riskScore,
  str,
  upperEnvironment,
} from '../lib/map.ts';
import { jobRef, poke } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import { grantState } from '../lib/rows.ts';

async function metrics(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.SubscriptionsMetricsQuery>;
  const m = obj(await ctx.db.call('subscriptions_metrics', { p_range: query.range }));
  const byStore: Record<string, number> = {};
  for (const [store, n] of Object.entries(obj(m.by_store))) byStore[store] = count(n);
  const byProduct: Record<string, number> = {};
  for (const p of arr(m.by_product)) {
    const id = str(p.product_id) ?? 'unknown';
    byProduct[id] = (byProduct[id] ?? 0) + count(p.active);
  }
  const revenue = ctx.can('metrics.revenue.read') && num(m.mrr_usd) !== null;
  return {
    data: {
      active_pro: count(m.active_pro),
      trials: count(m.trials),
      cancelled: count(m.cancelled),
      expired: count(m.expired),
      refunded: count(m.refunded),
      ...(revenue
        ? {
            mrr_usd: Math.max(0, num(m.mrr_usd) ?? 0),
            arr_estimate_usd: Math.max(0, num(m.arr_estimate_usd) ?? 0),
          }
        : {}),
      by_store: byStore,
      by_product: byProduct,
      renewal_rate: ratio(m.renewal_rate),
      store_pro: count(m.store_pro),
      grant_pro: count(m.grant_pro),
      both: count(m.both),
    },
  };
}

function billingRow(b: Json) {
  return {
    event_id: b.event_id,
    type: b.type,
    environment: upperEnvironment(b.environment) ?? 'PRODUCTION',
    received_at: b.received_at,
    processed: b.processed === true,
  };
}

/** `:id` is the RevenueCat `event_id` shown in the list (or the numeric row id). */
async function eventDetail(ctx: RouteCtx) {
  const id = String(ctx.params.id);
  let rowId: number | null = /^\d{1,18}$/.test(id) ? Number(id) : null;
  if (rowId === null) {
    const { data, error } = await ctx.rt.system
      .from('billing_events')
      .select('id')
      .eq('event_id', id)
      .maybeSingle();
    if (error !== null) throw mapDbError(error);
    rowId = num((data as Json | null)?.id);
  }
  if (rowId === null) throw new AppError('NOT_FOUND');
  const b = obj(await ctx.db.call('billing_event_get', { p_id: rowId }));
  const conversion = b.is_trial_conversion;
  return {
    data: {
      event_id: b.event_id,
      type: b.type,
      store: str(b.store),
      environment: upperEnvironment(b.environment) ?? 'PRODUCTION',
      product_id: str(b.product_id),
      period_type: str(b.period_type),
      purchased_at: str(b.purchased_at),
      expiration_at: str(b.expiration_at),
      event_at: b.event_at,
      price_usd: num(b.price_usd),
      price_local: num(b.price_local),
      currency: /^[A-Z]{3}$/.test(str(b.currency) ?? '') ? b.currency : null,
      cancel_reason: str(b.cancel_reason),
      expiration_reason: str(b.expiration_reason),
      is_trial_conversion: typeof conversion === 'boolean' ? conversion : null,
      received_at: b.received_at,
      processed_at: str(b.processed_at),
      processing_error_code: str(b.processing_error_code),
      job_id: str(b.job_id),
      user_id: str(b.user_id),
    },
  };
}

async function trialStream(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.TrialStreamQuery>;
  const filter: Json = { environment: filterValue(ctx.query, 'environment') };
  if (filterValue(ctx.query, 'store') !== undefined) filter.store = filterValue(ctx.query, 'store');
  if (filterValue(ctx.query, 'product') !== undefined)
    filter.product_id = filterValue(ctx.query, 'product');
  const out = obj(await ctx.db.call('trial_stream', { p_range: query.range, p_filter: filter }));
  const summary = obj(out.summary);
  return {
    data: {
      events: arr(out.rows).map((e) => ({
        event_id: e.event_id,
        kind: e.kind,
        email_masked: str(e.email_masked),
        product_id: str(e.product_id),
        store: str(e.store),
        event_at: e.event_at,
      })),
      summary: {
        conversions: count(summary.conversions),
        trial_expirations: count(summary.trial_expirations),
        conversion_rate: ratio(summary.conversion_rate),
      },
    },
  };
}

function grantRow(now: number) {
  return (g: Json) => ({
    id: g.id,
    user_id: g.user_id,
    email_masked: str(g.email_masked),
    source: g.source,
    duration_days: Math.max(1, count(g.duration_days)),
    starts_at: g.starts_at,
    ends_at: g.ends_at,
    state: str(g.state) ?? grantState(g, now),
    granted_by: str(g.granted_by),
    reason: str(g.reason),
    revoked_at: str(g.revoked_at),
    revoked_by: str(g.revoked_by),
  });
}

async function review(ctx: RouteCtx, decision: 'approve' | 'reject') {
  const body = ctx.body as z.infer<typeof A.ReferralReviewBody>;
  const out = obj(
    await ctx.db.call('referral_review', {
      p_referral: String(ctx.params.id),
      p_decision: decision,
      p_reason: body.reason,
    }),
  );
  if (decision === 'approve') await poke(ctx.rt, ctx.log, 'admin_referral_approved');
  return { data: { id: out.id, status: out.status } };
}

export const subscriptionsRoutes = defineRoutes({
  'GET /subscriptions/metrics': { rate: 'R', handle: metrics },
  'GET /subscriptions': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'subscriptions_list',
        listArgs(ctx.query, {
          filters: {
            status: 'status',
            store: 'store',
            product: 'product_id',
            environment: 'environment',
          },
        }),
      );
      return paged(ctx.query, out, (s) => ({
        user_id: s.user_id,
        status: s.status,
        store: str(s.store),
        product_id: str(s.product_id),
        period_type: str(s.period_type),
        expires_at: str(s.expires_at),
        will_renew: s.will_renew === true,
        source: 'store',
      }));
    },
  },
  'GET /subscriptions/events': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'billing_events_list',
        listArgs(ctx.query, {
          filters: { type: 'type', user: 'user_id', environment: 'environment' },
        }),
      );
      return paged(ctx.query, out, billingRow);
    },
  },
  'GET /subscriptions/trial-stream': { rate: 'R', handle: trialStream },
  'GET /subscriptions/events/:id': { rate: 'R', handle: eventDetail },
  'GET /entitlement-grants': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'entitlement_grants_list',
        listArgs(ctx.query, {
          filters: {
            source: 'source',
            state: 'state',
            granted_by_admin_id: 'granted_by_admin_id',
            user_id: 'user_id',
          },
        }),
      );
      return paged(ctx.query, out, grantRow(ctx.rt.now()));
    },
  },
  'POST /subscriptions/:userId/sync': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.SubscriptionResyncBody>;
      const out = obj(
        await ctx.db.call('subscription_resync', {
          p_user: String(ctx.params.userId),
          p_reason: body.reason,
        }),
      );
      await poke(ctx.rt, ctx.log, 'admin_billing_sync');
      return { data: { job: jobRef(String(out.job_id)) }, status: 202 as const };
    },
  },
  'GET /referrals/metrics': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.ReferralsMetricsQuery>;
      const m = obj(await ctx.db.call('referrals_metrics', { p_range: query.range }));
      return {
        data: {
          invites: count(m.invites),
          signups: count(m.applied),
          qualified: count(m.qualified),
          rewarded: count(m.rewarded),
          conversion: ratio(m.conversion),
          bonus_days_granted: count(m.bonus_days_granted),
          flagged: count(m.flagged_open),
        },
      };
    },
  },
  'GET /referrals': {
    rate: 'R',
    async handle(ctx) {
      const q = qValue(ctx.query);
      const out = await ctx.db.call(
        'referrals_list',
        listArgs(ctx.query, {
          filters: { status: 'status' },
          extraFilter: q === undefined ? {} : { q },
        }),
      );
      return paged(ctx.query, out, (r) => ({
        id: r.id,
        code: r.code,
        referrer_id: r.referrer_id,
        referee_id: r.referee_id,
        status: r.status,
        risk_score: riskScore(r.risk_score),
        signals_summary: (Array.isArray(r.signals_summary) ? r.signals_summary : []).filter(
          (s): s is string => typeof s === 'string',
        ),
        created_at: r.created_at,
      }));
    },
  },
  'POST /referrals/:id/approve': { rate: 'X', handle: (ctx) => review(ctx, 'approve') },
  'POST /referrals/:id/reject': { rate: 'X', handle: (ctx) => review(ctx, 'reject') },
});
