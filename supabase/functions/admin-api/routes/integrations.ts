/**
 * ADM-04 integrations (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.5; T-10.08): account health without
 * tokens (`integrations_overview`, `integrations_summary`, `integration_detail`) and the two
 * operations that enqueue jobs and poke the worker: force sync (`user_force_sync` scoped to the
 * account) and watch renewal (`integration_renew_watch`, `watch_renewal {mode:'recreate'}`).
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError } from '../../_shared/errors.ts';
import { listArgs, paged } from '../lib/list.ts';
import { arr, count, type Json, num, obj, ratio, str } from '../lib/map.ts';
import { poke } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

function integrationRow(a: Json) {
  const keyVersion = num(a.key_version);
  return {
    account_id: a.account_id,
    user_id: str(a.user_id) ?? str(obj(a.user).id),
    provider: a.provider,
    email_masked: str(a.email_masked),
    status: a.status,
    last_sync_at: str(a.last_sync_at),
    last_error_code: str(a.last_error_code),
    watch_expires_at: str(a.watch_expires_at),
    key_version: keyVersion === null || keyVersion < 1 ? null : Math.round(keyVersion),
  };
}

async function detail(ctx: RouteCtx) {
  const d = obj(
    await ctx.db.call('integration_detail', { p_account: String(ctx.params.accountId) }),
  );
  const webhooks = obj(d.webhook_stats);
  return {
    data: {
      account: integrationRow(d),
      granted_scopes: (Array.isArray(d.granted_scopes) ? d.granted_scopes : []).filter(
        (s): s is string => typeof s === 'string',
      ),
      sync_states: arr(d.sync_states).map((s) => ({
        resource: str(s.resource) ?? 'unknown',
        status: str(s.status) ?? 'unknown',
        last_success_at: str(s.last_success_at),
        last_error_code: str(s.last_error_code),
        watch_expires_at: str(s.watch_expires_at),
      })),
      recent_jobs: arr(d.jobs)
        .slice(0, 20)
        .map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          last_error_code: str(j.last_error_code),
          created_at: j.created_at,
        })),
      webhook_stats: {
        received_24h: count(webhooks.received_24h),
        unmatched_24h: count(webhooks.unmatched_24h),
        last_received_at: str(webhooks.last_received_at),
      },
    },
  };
}

async function forceSync(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.IntegrationForceSyncBody>;
  const accountId = String(ctx.params.accountId);
  const d = obj(await ctx.db.call('integration_detail', { p_account: accountId }));
  const userId = str(d.user_id) ?? str(obj(d.user).id);
  if (userId === null) throw new AppError('NOT_FOUND');
  const out = obj(
    await ctx.db.call('user_force_sync', {
      p_user: userId,
      p_account: accountId,
      p_reason: body.reason,
      p_resources: null,
    }),
  );
  const jobs = arr(out.jobs).map((j) => ({ job_id: j.job_id, type: j.type }));
  if (jobs.length > 0) await poke(ctx.rt, ctx.log, 'admin_integration_force_sync');
  return { data: { jobs }, status: 202 as const };
}

async function renewWatch(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.IntegrationRenewWatchBody>;
  const out = obj(
    await ctx.db.call('integration_renew_watch', {
      p_account: String(ctx.params.accountId),
      p_reason: body.reason,
    }),
  );
  const jobs = (Array.isArray(out.job_ids) ? out.job_ids : [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => ({ job_id: id, type: 'watch_renewal' }));
  if (jobs.length > 0) await poke(ctx.rt, ctx.log, 'admin_watch_renewal');
  return { data: { jobs }, status: 202 as const };
}

export const integrationsRoutes = defineRoutes({
  'GET /integrations': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'integrations_overview',
        listArgs(ctx.query, {
          filters: { provider: 'provider', status: 'status', issue: 'issue' },
        }),
      );
      return paged(ctx.query, out, integrationRow);
    },
  },
  'GET /integrations/summary': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.IntegrationsSummaryQuery>;
      const s = obj(await ctx.db.call('integrations_summary', { p_range: query.range }));
      return {
        data: {
          by_provider_status: arr(s.by_provider_status).map((r) => ({
            provider: r.provider,
            status: r.status,
            count: count(r.count),
          })),
          reconnect_rate: ratio(s.reconnect_rate),
          watches_expiring_24h: count(s.watches_expiring_24h),
          watch_renewals_failed_24h: count(s.watch_renewals_failed_24h),
          oldest_healthy_last_sync_at: str(s.oldest_healthy_last_sync_at),
        },
      };
    },
  },
  'GET /integrations/:accountId': { rate: 'R', handle: detail },
  'POST /integrations/:accountId/force-sync': { rate: 'M', handle: forceSync },
  'POST /integrations/:accountId/renew-watch': { rate: 'M', handle: renewWatch },
});
