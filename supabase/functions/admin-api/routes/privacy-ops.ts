/**
 * ADM-16 data requests and ADM-17 audit logs (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.19, §6.20,
 * §10; T-10.13). Statuses are the DB enums (`export_status`, `deletion_status`); warnings live in
 * `steps`; no route fakes completion. Retry and export regeneration re-queue the resumable jobs
 * (JOB-21/22/23) and poke the worker; the admin never receives a file, path or signed URL.
 * The audit log is read-only (no update or delete route exists). Audit row ids are bigint
 * identities carried in the contract's uuid form (`lib/map.ts` `auditIdToUuid`).
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError, mapDbError } from '../../_shared/errors.ts';
import { filterValue, paged } from '../lib/list.ts';
import {
  actorLabel,
  auditIdToUuid,
  count,
  type Json,
  num,
  obj,
  str,
  userRef,
  uuidToAuditId,
} from '../lib/map.ts';
import { poke } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import { auditListRow } from '../lib/rows.ts';

/** Contract kind ↔ `admin_api` kind. */
const KIND_TO_SQL: Readonly<Record<string, string>> = {
  export: 'export',
  exports: 'export',
  history_deletion: 'history',
  account_deletion: 'account',
};
const KIND_FROM_SQL: Readonly<Record<string, string>> = {
  export: 'export',
  history: 'history_deletion',
  account: 'account_deletion',
};

const STEP_STATUSES = new Set(['pending', 'done', 'warning', 'failed', 'skipped']);

/** `{step: status}` → `"step: status, …"` (`null` when there are no steps). */
function stepsSummary(value: unknown): string | null {
  const entries = Object.entries(obj(value))
    .map(([step, status]) => {
      const s = typeof status === 'string' ? status : str(obj(status).status);
      return s === null ? null : `${step}: ${s}`;
    })
    .filter((s): s is string => s !== null);
  return entries.length === 0 ? null : entries.join(', ').slice(0, 500);
}

function requestRow(r: Json) {
  return {
    id: r.id,
    kind: KIND_FROM_SQL[str(r.kind) ?? ''] ?? 'export',
    status: r.status,
    origin: r.origin,
    requested_at: r.requested_at,
    completed_at: str(r.completed_at),
    steps_summary: stepsSummary(r.steps_summary),
    user_ref: userRef(r.user_ref),
  };
}

function stepRows(steps: unknown) {
  return Object.entries(obj(steps)).map(([step, value]) => {
    const v = typeof value === 'string' ? { status: value } : obj(value);
    const status = str(v.status) ?? 'pending';
    return {
      step,
      status: STEP_STATUSES.has(status) ? status : status === 'completed' ? 'done' : 'pending',
      detail_code: str(v.detail_code) ?? str(v.error_code) ?? str(v.warning),
      at: str(v.at) ?? str(v.completed_at) ?? str(v.updated_at),
    };
  });
}

async function requestDetail(ctx: RouteCtx) {
  const kind = KIND_TO_SQL[String(ctx.params.kind)] ?? 'export';
  const d = obj(
    await ctx.db.call('data_request_get', { p_kind: kind, p_id: String(ctx.params.id) }),
  );
  const job = d.job === null || d.job === undefined ? null : obj(d.job);
  return {
    data: {
      ...requestRow({ ...d, steps_summary: d.steps, completed_at: d.completed_at ?? d.ready_at }),
      job:
        job === null
          ? null
          : {
              id: job.id,
              status: str(job.status) ?? 'unknown',
              progress:
                job.progress === null || job.progress === undefined ? null : obj(job.progress),
            },
      steps: stepRows(d.steps),
    },
  };
}

async function retry(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.DataRequestRetryBody>;
  const kind = KIND_TO_SQL[String(ctx.params.kind)] ?? 'export';
  const out = obj(
    await ctx.db.call('data_request_retry', {
      p_kind: kind,
      p_id: String(ctx.params.id),
      p_reason: body.reason,
    }),
  );
  await poke(ctx.rt, ctx.log, 'admin_data_request_retry');
  return { data: { id: out.id, job_id: out.job_id }, status: 202 as const };
}

async function regenerate(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.ExportRegenerateBody>;
  const out = obj(
    await ctx.db.call('export_regenerate', { p_id: String(ctx.params.id), p_reason: body.reason }),
  );
  await poke(ctx.rt, ctx.log, 'admin_export_regenerate');
  return {
    data: { export_request_id: out.export_request_id, job_id: out.job_id },
    status: 202 as const,
  };
}

/** The chain sequence bounds of a time window (service role; ids only). */
async function seqBound(ctx: RouteCtx, at: string, first: boolean): Promise<number | null> {
  const query = ctx.rt.system.from('audit_logs').select('chain_seq');
  const { data, error } = await (
    first
      ? query.gte('occurred_at', at).order('chain_seq', { ascending: true })
      : query.lt('occurred_at', at).order('chain_seq', { ascending: false })
  )
    .limit(1)
    .maybeSingle();
  if (error !== null) throw mapDbError(error);
  return num((data as Json | null)?.chain_seq);
}

async function verifyChain(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.AuditVerifyQuery>;
  const from = await seqBound(ctx, query.from, true);
  const to = await seqBound(ctx, query.to, false);
  if (from === null || to === null || to < from) return { data: { verified: true } };
  const out = obj(await ctx.db.call('audit_verify', { p_from: from, p_to: to }));
  const broken = auditIdToUuid(out.first_broken_id);
  return {
    data: {
      verified: out.verified === true,
      ...(out.verified === true || broken === null ? {} : { first_broken_id: broken }),
    },
  };
}

async function auditDetail(ctx: RouteCtx) {
  const id = uuidToAuditId(String(ctx.params.id));
  if (id === null) throw new AppError('NOT_FOUND');
  const a = obj(await ctx.db.call('audit_get', { p_id: id }));
  const actorType = str(a.actor_type);
  const targetUser =
    a.target_user === null || a.target_user === undefined ? null : obj(a.target_user);
  return {
    data: {
      id: auditIdToUuid(a.id),
      chain_seq: Math.max(1, count(a.chain_seq)),
      ts: a.ts,
      actor_type: actorType === 'admin' || actorType === 'user' ? actorType : 'system',
      actor: actorLabel(a.actor_type, a.actor),
      role: str(a.role),
      action: a.action,
      target_type: str(a.target_type),
      target_id: str(a.target_id),
      target_user:
        targetUser === null
          ? null
          : targetUser.deleted === true
            ? `deleted:${str(targetUser.subject_hash_prefix) ?? ''}`
            : (str(targetUser.id) ?? '').slice(0, 8),
      reason: str(a.reason),
      result: a.result,
      correlation_id: str(a.correlation_id),
      metadata: obj(a.metadata),
      prev_hash: str(a.prev_hash),
      hash: str(a.hash) ?? '',
    },
  };
}

export const privacyOpsRoutes = defineRoutes({
  'GET /data-requests': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.DataRequestsListQuery>;
      const filter: Json = {};
      if (filterValue(ctx.query, 'status') !== undefined)
        filter.status = filterValue(ctx.query, 'status');
      const out = await ctx.db.call('data_requests_list', {
        p_kind: KIND_TO_SQL[query.tab] ?? 'export',
        p_page: query.page,
        p_page_size: query.page_size,
        p_sort: query.order === 'asc' ? 'created_at' : '-created_at',
        p_filter: filter,
      });
      return paged(ctx.query, out, requestRow);
    },
  },
  'POST /data-requests/export/:id/regenerate': { rate: 'X', handle: regenerate },
  'GET /data-requests/:kind/:id': { rate: 'R', handle: requestDetail },
  'POST /data-requests/:kind/:id/retry': { rate: 'X', handle: retry },
  'GET /audit': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AuditListQuery>;
      const filter: Json = {};
      for (const key of [
        'actor_id',
        'actor_role',
        'action',
        'target_type',
        'target_id',
        'result',
        'from',
        'to',
      ] as const) {
        const v = filterValue(ctx.query, key);
        if (v !== undefined) filter[key] = v;
      }
      const out = await ctx.db.call('audit_list', {
        p_page: query.page,
        p_page_size: query.page_size,
        p_sort: null,
        p_filter: filter,
      });
      return paged(ctx.query, out, auditListRow);
    },
  },
  'GET /audit/verify-chain': { rate: 'R', handle: verifyChain },
  'GET /audit/:id': { rate: 'R', handle: auditDetail },
});
