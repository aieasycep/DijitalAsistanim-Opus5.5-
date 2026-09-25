/**
 * ADM-02 users and user actions (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.2, §6.3, §6.14; T-10.06).
 * Reads are the privacy-safe `admin_api.user_*` views (masked PII, counts, never content); tab
 * reads need their module permission too (`also`). Actions: reveal (audited, 60 s), force sync
 * (jobs + worker poke), disable/restore (SQL state + Auth ban/unban), entitlement grants and
 * revocation, integration disconnect (the `integration_purge` job) and the internal flag.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError } from '../../_shared/errors.ts';
import { auditWrite } from '../middleware/audit.ts';
import { emptyPage, filterValue, listArgs, paged, qValue } from '../lib/list.ts';
import {
  arr,
  count,
  type Json,
  num,
  obj,
  pushTokenMasked,
  riskScore,
  str,
  upperEnvironment,
  usd,
} from '../lib/map.ts';
import { poke, setAuthBan } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx, type RouteResult } from '../lib/route.ts';
import { auditListRow, grantState, resourceKind } from '../lib/rows.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function userId(ctx: RouteCtx): string {
  return String(ctx.params.id);
}

// ── Reads ────────────────────────────────────────────────────────────────────

function userRow(r: Json) {
  return {
    id: r.id,
    email_masked: r.email_masked,
    plan: r.is_trial === true ? 'trial' : r.plan === 'pro' ? 'pro' : 'free',
    created_at: r.created_at,
    last_active_at: str(r.last_active_at),
    platform: str(r.platform),
    connected_accounts: count(r.connected_accounts),
    last_sync_at: str(r.last_sync_at),
    status: r.status,
  };
}

/** `q` is an exact email (hashed lookup in SQL, audited) or a user id — never a partial search. */
async function usersList(ctx: RouteCtx): Promise<RouteResult> {
  const q = qValue(ctx.query);
  const extra: Json = {};
  if (q !== undefined) {
    if (UUID.test(q)) {
      extra.user_id = q.toLowerCase();
    } else if (EMAIL.test(q)) {
      const found = obj(await ctx.db.call('user_lookup_email', { p_email: q }));
      const id = str(found.user_id);
      if (id === null) return emptyPage(ctx.query);
      extra.user_id = id;
    } else {
      return emptyPage(ctx.query);
    }
  }
  const out = await ctx.db.call(
    'users_list',
    listArgs(ctx.query, { filters: { plan: 'plan', state: 'state' }, extraFilter: extra }),
  );
  return paged(ctx.query, out, userRow);
}

async function overview(ctx: RouteCtx) {
  const o = obj(await ctx.db.call('user_overview', { p_user: userId(ctx) }));
  return {
    data: {
      user_id: o.user_id,
      email_masked: str(o.email_masked),
      display_name_masked: str(o.display_name_masked),
      is_internal: o.is_internal === true,
      account_status: o.account_status,
      plan: o.plan === 'pro' ? 'pro' : 'free',
      integrations: arr(o.integrations).map((i) => ({
        provider: i.provider,
        status: i.status,
        last_sync_at: str(i.last_sync_at),
        last_error_code: str(i.last_error_code),
        watch_expires_at: str(i.watch_expires_at),
      })),
      job_errors: arr(o.job_errors)
        .map((j) => str(j.error_code))
        .filter((c): c is string => c !== null)
        .slice(0, 20),
      briefing_status: arr(o.briefing_status)
        .slice(0, 7)
        .map((b) => ({ local_date: b.local_date, kind: b.kind, status: b.status })),
      push_status: {
        tokens_enabled: count(obj(o.push_status).tokens_enabled),
        last_receipt_error: str(obj(o.push_status).last_receipt_error),
      },
      app_version: str(o.app_version),
      platform: str(o.platform),
    },
  };
}

async function integrations(ctx: RouteCtx) {
  const rows = arr(await ctx.db.call('user_integrations', { p_user: userId(ctx) }));
  return {
    data: rows.slice(0, 10).map((a) => ({
      account_id: a.account_id,
      provider: a.provider,
      email_masked: str(a.email_masked),
      capabilities_granted: Array.isArray(a.capabilities_granted) ? a.capabilities_granted : [],
      status: a.status,
      error_class: str(a.error_class),
      resources: arr(a.resources)
        .map((s) => ({
          resource: resourceKind(s.resource),
          last_success_at: str(s.last_success_at),
          last_error_code: str(s.last_error_code),
          consecutive_failures: count(s.consecutive_failures),
          watch_expires_at: str(s.watch_expires_at),
          watch_status: str(s.watch_status),
        }))
        .filter((s) => s.resource !== null),
      data_sources: obj(a.data_sources),
      recent_jobs: arr(a.recent_jobs).slice(0, 5),
    })),
  };
}

async function briefings(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.UserBriefingsQuery>;
  const filter: Json = {};
  for (const key of ['kind', 'status', 'from', 'to'] as const) {
    const v = filterValue(ctx.query, key);
    if (v !== undefined) filter[key] = v;
  }
  const out = await ctx.db.call('user_briefings', {
    p_user: userId(ctx),
    p_filter: filter,
    p_page: query.page,
    p_page_size: query.page_size,
  });
  return paged(ctx.query, out, (b) => ({
    id: b.id,
    kind: b.kind,
    local_date: b.local_date,
    status: b.status,
    scheduled_for: str(b.scheduled_for),
    generated_at: str(b.generated_at),
    delivered_at: str(b.delivered_at),
    latency_ms: num(b.latency_ms) === null ? null : count(b.latency_ms),
    item_count: count(b.item_count),
    ai_cost_usd: usd(b.ai_cost_usd),
    notification_decision: str(b.notification_decision),
    skip_reason: str(b.skip_reason),
    error_code: str(b.error_code),
  }));
}

const FEATURE_EVENTS = [
  'briefing_opened',
  'assistant_query_sent',
  'capture_created',
  'meeting_prep_opened',
  'follow_up_actioned',
  'search_performed',
  'approval_decided',
] as const;

async function usage(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.UserUsageQuery>;
  const u = obj(await ctx.db.call('user_usage', { p_user: userId(ctx), p_range: query.range }));
  const ai = obj(u.ai);
  const features = obj(u.feature_usage);
  const approvals = obj(u.approvals);
  const captures = obj(u.captures);
  const volumes = obj(u.content_volumes);
  const byDecision: Record<string, number> = {};
  for (const [decision, n] of Object.entries(obj(u.notifications_by_decision))) {
    byDecision[decision] = count(n);
  }
  return {
    data: {
      ai: {
        days: arr(ai.days).map((d) => ({
          date: d.date,
          feature: str(d.feature) ?? 'unknown',
          requests: count(d.requests),
          input_tokens: count(d.input_tokens),
          output_tokens: count(d.output_tokens),
          cost_usd: usd(d.cost_usd),
          units: count(d.units),
        })),
        daily_budget_units:
          num(ai.daily_budget_units) === null ? null : count(ai.daily_budget_units),
        budget_hit_days: count(ai.budget_hit_days),
      },
      feature_usage: Object.fromEntries(FEATURE_EVENTS.map((e) => [e, count(features[e])])),
      approvals: {
        created: count(approvals.created),
        approved: count(approvals.approved),
        executed: count(approvals.executed),
      },
      reminders_created: count(u.reminders_created),
      captures: { count: count(captures.count), bytes: count(captures.bytes) },
      content_volumes: {
        email_threads: count(volumes.email_threads),
        calendar_events: count(volumes.calendar_events),
        insights: count(volumes.insights),
        memory_chunks: count(volumes.memory_chunks),
      },
      notifications_by_decision: byDecision,
    },
  };
}

async function subscription(ctx: RouteCtx) {
  const s = obj(await ctx.db.call('user_subscription', { p_user: userId(ctx) }));
  const store = s.store === null || s.store === undefined ? null : obj(s.store);
  const effective = obj(s.effective);
  const now = ctx.rt.now();
  return {
    data: {
      store:
        store === null
          ? null
          : {
              store: str(store.store),
              product_id: str(store.product_id),
              period_type: str(store.period_type),
              is_active: store.is_active === true,
              will_renew: store.will_renew === true,
              expires_at: str(store.expires_at),
              billing_issue_detected_at: str(store.billing_issue_detected_at),
              environment: upperEnvironment(store.environment),
              synced_at: str(store.synced_at),
              last_event_id: str(store.last_event_id),
              original_transaction_id: null,
            },
      grants: arr(s.grants).map((g) => ({
        id: g.id,
        source: g.source,
        duration_days: count(g.duration_days),
        starts_at: g.starts_at,
        ends_at: g.ends_at,
        state: str(g.state) ?? grantState(g, now),
        granted_by: str(g.granted_by),
        reason: str(g.reason),
        revoked_at: str(g.revoked_at),
      })),
      effective: {
        entitlement: effective.entitlement === 'pro' ? 'pro' : 'free',
        source: str(effective.source),
        until: str(effective.until),
      },
      ...(Array.isArray(s.billing_events)
        ? {
            billing_events: arr(s.billing_events)
              .slice(0, 20)
              .map((b) => ({
                event_id: b.event_id,
                type: b.type,
                environment: upperEnvironment(b.environment) ?? 'PRODUCTION',
                received_at: b.received_at,
                processed: b.processed === true,
              })),
          }
        : {}),
    },
  };
}

async function referrals(ctx: RouteCtx) {
  const r = obj(await ctx.db.call('user_referrals', { p_user: userId(ctx) }));
  const status = filterValue(ctx.query, 'status');
  const referee = r.as_referee === null || r.as_referee === undefined ? null : obj(r.as_referee);
  const yearly = obj(r.yearly_rewards);
  return {
    data: {
      code: str(r.code),
      as_referrer: arr(r.as_referrer)
        .filter((x) => status === undefined || x.status === status)
        .map((x) => ({
          id: x.id,
          referee_masked: str(x.referee_masked) ?? '***',
          status: x.status,
          risk_score: riskScore(x.risk_score),
          signal_labels: Array.isArray(x.signal_labels) ? x.signal_labels : [],
          created_at: x.created_at,
          qualified_at: str(x.qualified_at),
          rewarded_at: str(x.rewarded_at),
        })),
      as_referee:
        referee === null
          ? null
          : {
              id: referee.id,
              referrer_masked: str(referee.referrer_masked) ?? '***',
              status: referee.status,
            },
      credits: arr(r.credits).map((c) => ({
        referral_id: c.referral_id,
        side: c.side,
        grant_id: str(c.grant_id),
        days: count(c.days),
      })),
      yearly_rewards: { used: count(yearly.used), max: count(yearly.max) },
    },
  };
}

async function support(ctx: RouteCtx) {
  const s = obj(await ctx.db.call('user_support', { p_user: userId(ctx) }));
  const status = filterValue(ctx.query, 'status');
  return {
    data: {
      tickets: arr(s.tickets)
        .filter((t) => status === undefined || t.status === status)
        .map((t) => ({ ...t, assignee: str(t.assignee) })),
      access_grants: arr(s.access_grants).map((g) => ({
        ...g,
        scopes: Array.isArray(g.scopes) ? g.scopes : [],
        reveal_count: count(g.reveal_count),
        active: g.active === true,
      })),
    },
  };
}

async function userAudit(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.AuditListQuery>;
  const filter: Json = {};
  for (const key of ['action', 'actor_id', 'result', 'from', 'to'] as const) {
    const v = filterValue(ctx.query, key);
    if (v !== undefined) filter[key] = v;
  }
  const out = await ctx.db.call('user_audit', {
    p_user: userId(ctx),
    p_page: query.page,
    p_page_size: query.page_size,
    p_filter: filter,
  });
  return paged(ctx.query, out, auditListRow);
}

async function devices(ctx: RouteCtx) {
  const rows = arr(await ctx.db.call('user_devices', { p_user: userId(ctx) }));
  return {
    data: rows.map((d) => ({
      installation_id: d.installation_id,
      platform: d.platform,
      app_version: d.app_version,
      build_number: str(d.build_number) ?? '',
      os_version: str(d.os_version),
      push_enabled: d.push_enabled === true,
      token_masked: pushTokenMasked(d.token_masked),
      last_seen_at: d.last_seen_at,
      last_receipt_status: str(d.last_receipt_status),
      last_receipt_error: str(d.last_receipt_error),
    })),
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function reveal(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.UserRevealBody>;
  const out = obj(
    await ctx.db.call('user_reveal_email', {
      p_user: userId(ctx),
      p_reason: body.reason,
      p_field: body.field,
    }),
  );
  return { data: { value: str(out.value) ?? '', expires_in_s: 60 } };
}

async function forceSync(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.UserForceSyncBody>;
  const out = obj(
    await ctx.db.call('user_force_sync', {
      p_user: userId(ctx),
      p_account: null,
      p_reason: body.reason,
      p_resources: body.resources ?? null,
    }),
  );
  const jobs = arr(out.jobs).map((j) => ({ job_id: j.job_id, type: j.type }));
  if (jobs.length > 0) await poke(ctx.rt, ctx.log, 'admin_force_sync');
  return { data: { jobs }, status: 202 as const };
}

/**
 * Disable / restore: the SQL state change is authoritative (the `api` gate reads it); the Auth
 * ban/unban follows. A ban failure is a partial outcome (`failure` audit row, 503, retryable): a
 * retry finds the state already changed and completes the Auth step.
 */
async function setDisabled(ctx: RouteCtx, disable: boolean) {
  const body = ctx.body as z.infer<typeof A.UserDisableBody>;
  const id = userId(ctx);
  let resumed = false;
  try {
    await ctx.db.call(disable ? 'user_disable' : 'user_restore', {
      p_user: id,
      p_reason: body.reason,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'STATE_CONFLICT') throw error;
    // Only a state already at the target (a retried partial) resumes; anything else stays a conflict.
    const current = obj(await ctx.db.call('user_overview', { p_user: id }));
    if (current.account_status !== (disable ? 'disabled' : 'active')) throw error;
    resumed = true;
  }
  const action = disable ? 'user.disabled' : 'user.restored';
  try {
    await setAuthBan(ctx.rt, id, disable);
  } catch (error) {
    await auditWrite(ctx.db, {
      action,
      targetType: 'user',
      targetId: id,
      targetUserId: id,
      reason: body.reason,
      result: 'failure',
      details: { partial: true, step: disable ? 'auth_ban' : 'auth_unban' },
    });
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { partial: true, step: disable ? 'auth_ban' : 'auth_unban' },
      cause: error,
    });
  }
  if (resumed) {
    await auditWrite(ctx.db, {
      action,
      targetType: 'user',
      targetId: id,
      targetUserId: id,
      reason: body.reason,
      result: 'success',
      details: { resumed: true },
      idempotencyKey: ctx.idempotencyKey,
    });
  }
  return { data: { user_id: id, account_status: disable ? 'disabled' : 'active' } };
}

async function grant(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.EntitlementGrantBody>;
  if (!ctx.can('entitlements.grant') && !A.isLimitedGrantAllowed(body)) {
    throw new AppError('FORBIDDEN', { details: { permission: 'entitlements.grant' } });
  }
  const g = obj(
    await ctx.db.call('entitlement_grant', {
      p_user: userId(ctx),
      p_days: body.duration_days,
      p_source: body.source,
      p_reason: body.reason,
      p_idempotency_key: ctx.idempotencyKey,
    }),
  );
  return {
    data: {
      id: g.id,
      user_id: g.user_id,
      source: g.source,
      duration_days: count(g.duration_days),
      starts_at: g.starts_at,
      ends_at: g.ends_at,
      state: grantState(g, ctx.rt.now()),
    },
    status: 201 as const,
  };
}

async function revokeGrant(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.GrantRevokeBody>;
  const id = userId(ctx);
  const grantId = String(ctx.params.grantId).toLowerCase();
  const list = obj(
    await ctx.db.call('entitlement_grants_list', {
      p_page: 1,
      p_page_size: 100,
      p_sort: '-starts_at',
      p_filter: { user_id: id },
    }),
  );
  const row = arr(list.rows).find((g) => str(g.id)?.toLowerCase() === grantId);
  if (row === undefined) throw new AppError('NOT_FOUND');
  await ctx.db.call('entitlement_revoke', { p_grant: grantId, p_reason: body.reason });
  return {
    data: {
      id: row.id,
      user_id: row.user_id,
      source: row.source,
      duration_days: count(row.duration_days),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      state: 'revoked',
    },
  };
}

/**
 * Admin disconnect: `admin_api.integration_disconnect` enqueues `integration_purge` (mode
 * `admin_disconnect`: stop watches, provider revoke, credential deletion, optional content purge)
 * and admin-api pokes the worker. No provider call happens inside this request, so the answer
 * reports `local_only` and the account's current status; the job records the provider outcome.
 */
async function disconnect(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AdminDisconnectBody>;
  const accountId = String(ctx.params.accountId).toLowerCase();
  const accounts = arr(await ctx.db.call('user_integrations', { p_user: userId(ctx) }));
  const account = accounts.find((a) => str(a.account_id)?.toLowerCase() === accountId);
  if (account === undefined) throw new AppError('NOT_FOUND');
  await ctx.db.call('integration_disconnect', {
    p_account: accountId,
    p_reason: body.reason,
    p_purge_content: body.purge_content,
  });
  await poke(ctx.rt, ctx.log, 'admin_integration_disconnect');
  return {
    data: { account_id: account.account_id, status: account.status, revocation: 'local_only' },
  };
}

export const usersRoutes = defineRoutes({
  'GET /users': { rate: 'R', handle: usersList },
  'POST /users/lookup': {
    rate: 'S',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.UserLookupBody>;
      const out = obj(await ctx.db.call('user_lookup_email', { p_email: body.email }));
      const id = str(out.user_id);
      if (id === null) throw new AppError('NOT_FOUND');
      return { data: { user_id: id } };
    },
  },
  'GET /users/:id': { rate: 'R', handle: overview },
  'GET /users/:id/integrations': { rate: 'R', handle: integrations },
  'GET /users/:id/briefings': { rate: 'R', handle: briefings },
  'GET /users/:id/usage': { rate: 'R', handle: usage },
  'GET /users/:id/subscription': { rate: 'R', handle: subscription },
  'GET /users/:id/referrals': { rate: 'R', handle: referrals },
  'GET /users/:id/support': { rate: 'R', handle: support },
  'GET /users/:id/audit': { rate: 'R', handle: userAudit },
  'GET /users/:id/devices': { rate: 'R', handle: devices },
  'POST /users/:id/reveal': { rate: 'X', replay: 'refuse', handle: reveal },
  'POST /users/:id/force-sync': { rate: 'M', handle: forceSync },
  'POST /users/:id/disable': { rate: 'X', handle: (ctx) => setDisabled(ctx, true) },
  'POST /users/:id/restore': { rate: 'X', handle: (ctx) => setDisabled(ctx, false) },
  'POST /users/:id/entitlement-grants': { rate: 'X', handle: grant },
  'POST /users/:id/entitlement-grants/:grantId/revoke': { rate: 'X', handle: revokeGrant },
  'POST /users/:id/integrations/:accountId/disconnect': { rate: 'X', handle: disconnect },
  'POST /users/:id/internal': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.UserInternalBody>;
      const out = obj(
        await ctx.db.call('user_mark_internal', {
          p_user: userId(ctx),
          p_internal: body.internal,
          p_reason: body.reason,
        }),
      );
      return { data: { user_id: out.user_id, internal: out.is_internal === true } };
    },
  },
});
