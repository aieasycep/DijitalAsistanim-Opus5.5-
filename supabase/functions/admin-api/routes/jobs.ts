/**
 * ADM-05 sync and jobs (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.6, §8; T-10.08): the job list,
 * stats, detail (payload redacted to id fields in SQL), the correlation trace and the safe retry
 * policy (`job_retry` / `job_retry_bulk` only from `failed` / `dead_letter`, per-type policy in
 * `private.job_admin_policy`; `job_cancel` for queued work). Retries poke the worker.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { listArgs, paged, qValue } from '../lib/list.ts';
import { arr, count, type Json, num, obj, str } from '../lib/map.ts';
import { poke } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jobRow(j: Json) {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    attempts: count(j.attempts),
    max_attempts: Math.max(1, count(j.max_attempts)),
    last_error_code: str(j.last_error_code),
    run_after: j.run_after,
    created_at: j.created_at,
    correlation_id: str(j.correlation_id),
    user_id: str(j.user_id),
  };
}

const ATTEMPT_OUTCOMES = new Set(['completed', 'retrying', 'failed', 'dead_letter']);

async function jobDetail(ctx: RouteCtx) {
  const j = obj(await ctx.db.call('job_detail', { p_job: String(ctx.params.id) }));
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(obj(j.payload))) {
    if (typeof value === 'string') payload[key] = value.slice(0, 80);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      payload[key] = value;
  }
  return {
    data: {
      ...jobRow(j),
      payload,
      attempts_history: arr(j.attempts_history).map((a) => {
        const outcome = str(a.outcome);
        return {
          attempt: Math.max(1, count(a.attempt)),
          outcome:
            outcome === null ? 'running' : ATTEMPT_OUTCOMES.has(outcome) ? outcome : 'failed',
          error_code: str(a.error_code),
          duration_ms: num(a.duration_ms) === null ? null : count(a.duration_ms),
          started_at: a.started_at,
        };
      }),
      children: arr(j.children).map((c) => ({ id: c.id, type: c.type, status: c.status })),
    },
  };
}

const TRACE_KINDS: Readonly<Record<string, string>> = {
  approval_event: 'approval',
  job: 'job',
  job_attempt: 'job_attempt',
  ai_request: 'ai_request',
  notification: 'notification',
  push_ticket: 'push_ticket',
  audit: 'audit',
  briefing: 'briefing',
  webhook: 'webhook',
  billing_event: 'billing_event',
};

/** Timeline rows `(kind, id, ts, status, label_key, link)`; a non-uuid id matches nothing. */
async function correlation(ctx: RouteCtx) {
  const id = String(ctx.params.id);
  if (!UUID.test(id)) return { data: [] };
  const rows = arr(await ctx.db.call('correlation_trace', { p_correlation_id: id }));
  return {
    data: rows.slice(0, 500).map((r) => {
      const kind = TRACE_KINDS[str(r.kind) ?? ''] ?? 'job';
      const rowId = str(r.id) ?? '';
      return {
        kind,
        id: rowId,
        ts: r.ts,
        status: str(r.status),
        label_key: str(r.label_key) ?? kind,
        link:
          kind === 'job' ? `/jobs/${rowId}` : kind === 'briefing' ? `/briefings?id=${rowId}` : null,
      };
    }),
  };
}

async function retry(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.JobRetryBody>;
  const out = obj(
    await ctx.db.call('job_retry', {
      p_job: String(ctx.params.id),
      p_reason: body.reason,
      p_reset_attempts: body.reset_attempts,
    }),
  );
  await poke(ctx.rt, ctx.log, 'admin_job_retry');
  return { data: { id: out.id, status: out.status } };
}

async function retryBulk(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.JobsBulkRetryBody>;
  const out = obj(
    await ctx.db.call('job_retry_bulk', {
      p_type: body.filter.type,
      p_status: body.filter.status,
      p_reason: body.reason,
      p_max: body.max,
      p_from: body.filter.from,
      p_to: body.filter.to,
    }),
  );
  const retried = count(out.retried);
  if (retried > 0) await poke(ctx.rt, ctx.log, 'admin_job_retry_bulk');
  return { data: { retried } };
}

export const jobsRoutes = defineRoutes({
  'GET /jobs': {
    rate: 'R',
    async handle(ctx) {
      const q = qValue(ctx.query);
      const out = await ctx.db.call(
        'jobs_list',
        listArgs(ctx.query, {
          filters: {
            type: 'type',
            status: 'status',
            user_id: 'user_id',
            account_id: 'account_id',
            from: 'from',
            to: 'to',
          },
          extraFilter: q === undefined ? {} : { q },
        }),
      );
      return paged(ctx.query, out, jobRow);
    },
  },
  'GET /jobs/stats': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.JobsStatsQuery>;
      const s = obj(await ctx.db.call('jobs_summary', { p_range: query.range }));
      return {
        data: {
          by_type_status: arr(s.by_type_status).map((r) => ({
            type: r.type,
            status: r.status,
            count: count(r.count),
          })),
          dead_letter: count(s.dead_letter),
        },
      };
    },
  },
  'POST /jobs/retry-bulk': { rate: 'X', handle: retryBulk },
  'GET /jobs/:id': { rate: 'R', handle: jobDetail },
  'GET /correlation/:id': { rate: 'R', handle: correlation },
  'POST /jobs/:id/retry': { rate: 'M', handle: retry },
  'POST /jobs/:id/cancel': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.JobCancelBody>;
      const out = obj(
        await ctx.db.call('job_cancel', { p_job: String(ctx.params.id), p_reason: body.reason }),
      );
      return { data: { id: out.id, status: out.status } };
    },
  },
});
