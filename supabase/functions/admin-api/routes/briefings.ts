/**
 * ADM-06 briefings and ADM-07 notifications (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.7, §6.8;
 * T-10.09). Rows never carry narrative, sections or rendered text. Regeneration re-queues the
 * briefing job (`briefing_regenerate`); the test push (`notification_send_test`) queues the generic
 * "Dijital Asistan" / "Test bildirimi" through the notification job, bypassing caps but never quiet
 * hours (R-13) — `deferred_until` reports the quiet-hours delay.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { fieldError } from '../../_shared/errors.ts';
import { filterValue, listArgs, paged } from '../lib/list.ts';
import { count, type Json, num, obj, ratio, str, usd } from '../lib/map.ts';
import { jobRef, poke } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

function briefingRow(b: Json) {
  const mode = str(b.narrative_mode);
  return {
    id: b.id,
    user_id: b.user_id,
    kind: b.kind,
    local_date: b.local_date,
    status: b.status,
    generated_at: str(b.generated_at),
    delivered_at: str(b.delivered_at),
    latency_ms: num(b.latency_ms) === null ? null : count(b.latency_ms),
    narrative_mode: mode === 'llm' || mode === 'template' ? mode : null,
  };
}

function counts(record: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj(record))) out[key] = count(value);
  return out;
}

async function regenerate(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.BriefingRegenerateBody>;
  const out = obj(
    await ctx.db.call('briefing_regenerate', {
      p_briefing: String(ctx.params.id),
      p_reason: body.reason,
    }),
  );
  await poke(ctx.rt, ctx.log, 'admin_briefing_regenerate');
  return { data: { briefing_id: out.id, job: jobRef(String(out.job_id)) }, status: 202 as const };
}

async function notificationsList(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.NotificationsListQuery>;
  const user = filterValue(ctx.query, 'user_id');
  // User-level debugging only (API_CONTRACTS ADM-07): the list is always scoped to one user.
  if (user === undefined) throw fieldError('query.filter[user_id]', 'required');
  const filter: Json = {};
  if (filterValue(ctx.query, 'category') !== undefined)
    filter.category = filterValue(ctx.query, 'category');
  if (filterValue(ctx.query, 'decision') !== undefined)
    filter.decision = filterValue(ctx.query, 'decision');
  const out = await ctx.db.call('notifications_user_debug', {
    p_user: user,
    p_page: query.page,
    p_page_size: query.page_size,
    p_filter: filter,
  });
  return paged(ctx.query, out, (n) => ({
    id: n.id,
    category: n.category,
    decision: n.decision,
    decision_reason: str(n.decision_reason),
    detail_mode: n.detail_mode,
    sent_at: str(n.sent_at),
    receipt_status: str(n.receipt_status),
  }));
}

async function testPush(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AdminTestPushBody>;
  const out = obj(
    await ctx.db.call('notification_send_test', {
      p_user: body.user_id,
      p_reason: body.reason,
      p_installation: body.installation_id ?? null,
    }),
  );
  await poke(ctx.rt, ctx.log, 'admin_test_push');
  return {
    data: {
      notification_id: out.notification_id,
      job: jobRef(String(out.job_id)),
      deferred_until: str(out.deferred_until),
    },
    status: 202 as const,
  };
}

/** The push-test dialog's quiet-hours preview (R-13: a test never bypasses quiet hours). */
async function testPushPreview(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.AdminTestPushPreviewQuery>;
  const out = obj(
    await ctx.db.call('notification_test_preview', {
      p_user: query.user_id,
      p_installation: query.installation_id ?? null,
    }),
  );
  return {
    data: {
      timezone: str(out.timezone) ?? 'Europe/Istanbul',
      local_time: str(out.local_time) ?? '00:00',
      in_quiet_hours: out.in_quiet_hours === true,
      quiet_hours_end_local: str(out.quiet_hours_end_local),
      deferred_until: str(out.deferred_until),
      active_devices: count(out.active_devices),
    },
  };
}

export const briefingsRoutes = defineRoutes({
  'GET /briefings/metrics': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.BriefingsMetricsQuery>;
      const m = obj(
        await ctx.db.call('briefings_metrics', {
          p_range: query.range,
          p_kind: query.kind ?? null,
        }),
      );
      return {
        data: {
          scheduled: count(m.scheduled),
          generated: count(m.generated),
          delivered: count(m.delivered),
          failed: count(m.failed),
          skipped: count(m.skipped),
          p50_latency_ms: num(m.p50_latency_ms) === null ? null : count(m.p50_latency_ms),
          p95_latency_ms: num(m.p95_latency_ms) === null ? null : count(m.p95_latency_ms),
          ai_cost_usd: usd(m.ai_cost_usd),
          template_fallback_rate: ratio(m.template_fallback_rate),
        },
      };
    },
  },
  'GET /briefings': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'briefings_list',
        listArgs(ctx.query, {
          filters: { user_id: 'user_id', kind: 'kind', status: 'status', local_date: 'local_date' },
        }),
      );
      return paged(ctx.query, out, briefingRow);
    },
  },
  'POST /briefings/:id/regenerate': { rate: 'M', handle: regenerate },
  'GET /notifications/metrics': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.NotificationsMetricsQuery>;
      const m = obj(
        await ctx.db.call('notifications_metrics', {
          p_range: query.range,
          p_category: query.category ?? null,
        }),
      );
      return {
        data: {
          scheduled: count(m.scheduled),
          sent: count(m.sent),
          failed: count(m.failed),
          suppressed: count(m.suppressed),
          deduplicated: count(m.deduplicated),
          suppression_reasons: counts(m.suppression_reasons),
          receipt_errors: counts(m.receipt_errors),
        },
      };
    },
  },
  'GET /notifications': { rate: 'R', handle: notificationsList },
  'POST /notifications/test-push': { rate: 'X', handle: testPush },
  'GET /notifications/test-push/preview': { rate: 'R', handle: testPushPreview },
});
