/**
 * ADM-18 system health, ADM-19 admin users, ADM-20 settings, ADM-21 global search (API_CONTRACTS
 * §12.3; BACKOFFICE_PLAN §3.5, §4.4, §6.21–§6.25, §11; R-08; T-10.14).
 *
 * - `POST /health/run` calls the `health` function (HLT-02) with the admin JWT after
 *   `authorize('health.run')` and ends with `audit_write`; a missing credential stays
 *   `external_credential_required`, never healthy.
 * - Invites: the email credential and `ADMIN_ORIGIN` are checked before anything is created; the
 *   domain allow-list (`ADMIN_ALLOWED_EMAIL_DOMAINS`) applies; `auth.admin.createUser` creates the
 *   dedicated identity (`app_metadata.da_kind='admin'`), `admin_invite_record` stores the token hash
 *   (72 h) — the Auth user is deleted again if that fails — and the invite email (JOB-31) carries
 *   the sealed token. An existing app-user email never becomes an admin.
 * - Disable / enable ban or unban the Auth identity; reset-mfa deletes the TOTP factors after the
 *   SQL half; resend-invite rotates the token; unlock clears the lock and the sign-in counters.
 *   `admin_invite_rotate`, `admin_mfa_reset` and `admin_unlock` re-check the 10-minute step-up in SQL.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { randomToken } from '../../_shared/crypto/pkce.ts';
import { AppError, fieldError, mapDbError } from '../../_shared/errors.ts';
import { auditWrite, authorize } from '../middleware/audit.ts';
import { arr, count, type Json, num, obj, str } from '../lib/map.ts';
import {
  deleteMfaFactors,
  emailLookupHash,
  enqueueEmail,
  poke,
  requireEmailCredential,
  sealInviteToken,
  setAuthBan,
  sha256Bytea,
} from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

const PROBES = new Set<string>(A.HEALTH_PROBE_VALUES);
const DAY_MS = 86_400_000;

// ── ADM-18 Health ────────────────────────────────────────────────────────────

function credentialExpiry(ctx: RouteCtx, rows: Json[]) {
  const nowMs = ctx.rt.now();
  const out = new Map<
    string,
    { key: string; not_after: string | null; days_left: number | null }
  >();
  const add = (key: string, notAfter: string | null) => {
    const iso =
      notAfter === null
        ? null
        : /^\d{4}-\d{2}-\d{2}$/.test(notAfter)
          ? `${notAfter}T00:00:00Z`
          : notAfter;
    const ms = iso === null ? Number.NaN : Date.parse(iso);
    out.set(key, {
      key,
      not_after: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
      days_left: Number.isNaN(ms) ? null : Math.floor((ms - nowMs) / DAY_MS),
    });
  };
  for (const r of rows)
    add(str(r.component) ?? 'unknown', str(r.not_after) ?? str(r.rotation_due_at));
  for (const key of [
    'MICROSOFT_CERT_NOT_AFTER',
    'MICROSOFT_LOGIN_SECRET_NOT_AFTER',
    'APPLE_SIWA_WEB_SECRET_NOT_AFTER',
  ]) {
    const value = ctx.rt.env.raw[key]?.trim();
    if (value !== undefined && value !== '' && !out.has(key)) add(key, value);
  }
  return [...out.values()];
}

async function healthSummary(ctx: RouteCtx) {
  const h = obj(await ctx.db.call('health_latest'));
  return {
    data: {
      components: arr(h.components)
        .filter((c) => PROBES.has(str(c.component) ?? ''))
        .map((c) => ({
          component: c.component,
          status: c.status,
          latency_ms: num(c.latency_ms) === null ? null : count(c.latency_ms),
          checked_at: c.checked_at,
          detail_code: str(c.detail_code),
        })),
      credential_expiry: credentialExpiry(ctx, arr(h.credential_expiry)),
    },
  };
}

/** HLT-02 through the `health` function (≤ 30 s), with the admin JWT and the BFF key. */
async function healthRun(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.HealthRunBody>;
  await authorize(ctx.db, 'health.run');
  const response = await ctx.rt
    .fetch(`${ctx.rt.env.functionsBaseUrl}/functions/v1/health/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.jwt ?? ''}`,
        'x-da-bff': ctx.rt.env.bffSecret ?? '',
        'Content-Type': 'application/json',
        'X-Correlation-Id': ctx.c.get('correlationId'),
      },
      body: JSON.stringify(body.probes === undefined ? {} : { probes: body.probes }),
      signal: AbortSignal.timeout(30_000),
    })
    .catch((cause: unknown) => {
      throw new AppError('UPSTREAM_TIMEOUT', { details: { service: 'health' }, cause });
    });
  const payload = obj(await response.json().catch(() => ({})));
  if (!response.ok) {
    const code = str(obj(payload.error).code);
    throw new AppError(
      code === 'FORBIDDEN' || code === 'AUTH_REQUIRED' || code === 'RATE_LIMITED'
        ? code
        : 'SERVICE_UNAVAILABLE',
      { details: { service: 'health', status: response.status } },
    );
  }
  const results = arr(obj(payload.data).results).map((r) => ({
    probe: r.probe,
    status: r.status,
    latency_ms: num(r.latency_ms) === null ? null : count(r.latency_ms),
    detail_code: str(r.detail_code),
    checked_at: r.checked_at,
  }));
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + 1;
  await auditWrite(ctx.db, {
    action: 'admin.health.run',
    targetType: 'system_health',
    targetId: null,
    reason: 'manual health probe run',
    result: 'success',
    details: { probes: body.probes?.length ?? PROBES.size, ...byStatus },
    idempotencyKey: ctx.idempotencyKey,
  });
  return { data: { results } };
}

// ── ADM-19 Admin users ───────────────────────────────────────────────────────

function adminRow(a: Json) {
  return {
    id: a.id,
    email: a.email,
    role: a.role,
    status: a.status,
    last_login_at: str(a.last_login_at),
    mfa_enrolled: a.mfa_enrolled === true,
  };
}

async function adminRowById(ctx: RouteCtx, id: string) {
  const rows = arr(obj(await ctx.db.call('admins_list')).rows);
  const row = rows.find((r) => str(r.id)?.toLowerCase() === id.toLowerCase());
  if (row === undefined) throw new AppError('NOT_FOUND');
  return row;
}

function inviteConfig(ctx: RouteCtx): string {
  requireEmailCredential(ctx.rt);
  const origin = ctx.rt.env.adminOrigin;
  if (origin === undefined) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'admin_invite', credential_keys: ['ADMIN_ORIGIN'] },
    });
  }
  return origin;
}

async function queueInviteEmail(ctx: RouteCtx, adminId: string, token: string) {
  await enqueueEmail(ctx.rt, {
    templateKey: 'admin_invite',
    recipient: { type: 'admin_user', id: adminId },
    locale: 'tr',
    params: { invite_token_sealed: await sealInviteToken(ctx.rt, adminId, token) },
    unique: ctx.idempotencyKey ?? crypto.randomUUID(),
    correlationId: ctx.c.get('correlationId'),
  });
  await poke(ctx.rt, ctx.log, 'admin_invite_email');
}

async function invite(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AdminInviteBody>;
  inviteConfig(ctx);
  await authorize(ctx.db, 'admins.manage');
  const email = body.email.trim().toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const allowed = ctx.rt.env.allowedEmailDomains;
  if (allowed.length > 0 && !allowed.includes(domain))
    throw fieldError('email', 'domain_not_allowed');

  const created = await ctx.rt.system.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { da_kind: 'admin' },
  });
  if (created.error !== null || created.data.user === null) {
    const { data, error } = await ctx.rt.system
      .from('admin_users')
      .select('user_id')
      .eq('email', email)
      .maybeSingle();
    if (error !== null) throw mapDbError(error);
    if (data !== null)
      throw new AppError('STATE_CONFLICT', { details: { reason: 'admin_exists' } });
    const status = (created.error as { status?: number } | null)?.status ?? 0;
    if (status === 422 || status === 409 || status === 400)
      throw fieldError('email', 'email_in_use_by_app_user');
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { reason: 'auth_admin', step: 'create_user' },
    });
  }
  const userId = created.data.user.id;
  const token = randomToken(32);
  try {
    await ctx.db.call('admin_invite_record', {
      p_user: userId,
      p_email: email,
      p_role: body.role,
      p_display_name: body.full_name,
      p_reason: body.reason,
      p_token_hash: await sha256Bytea(token),
    });
  } catch (error) {
    const { error: deleteError } = await ctx.rt.system.auth.admin.deleteUser(userId);
    if (deleteError !== null)
      ctx.log.error('admin_invite_rollback_failed', { step: 'delete_user' });
    throw error;
  }
  await queueInviteEmail(ctx, userId, token);
  return {
    data: {
      id: userId,
      email,
      role: body.role,
      status: 'invited',
      last_login_at: null,
      mfa_enrolled: false,
    },
    status: 201 as const,
  };
}

async function setAdminBan(ctx: RouteCtx, id: string, banned: boolean, reason: string) {
  try {
    await setAuthBan(ctx.rt, id, banned);
  } catch (error) {
    await auditWrite(ctx.db, {
      action: banned ? 'admin.admin.disabled' : 'admin.admin.enabled',
      targetType: 'admin_user',
      targetId: id,
      reason,
      result: 'failure',
      details: { partial: true, step: banned ? 'auth_ban' : 'auth_unban' },
    });
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { partial: true, step: banned ? 'auth_ban' : 'auth_unban' },
      cause: error,
    });
  }
}

async function resetMfa(ctx: RouteCtx) {
  const id = String(ctx.params.id);
  const body = ctx.body as z.infer<typeof A.AdminResetMfaBody>;
  await ctx.db.call('admin_mfa_reset', { p_user: id, p_reason: body.reason });
  try {
    await deleteMfaFactors(ctx.rt, id);
  } catch (error) {
    await auditWrite(ctx.db, {
      action: 'admin.admin.mfa_reset',
      targetType: 'admin_user',
      targetId: id,
      reason: body.reason,
      result: 'failure',
      details: { partial: true, step: 'delete_factors' },
    });
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { partial: true, step: 'delete_factors' },
      cause: error,
    });
  }
  return { data: adminRow(await adminRowById(ctx, id)) };
}

async function resendInvite(ctx: RouteCtx) {
  const id = String(ctx.params.id);
  const body = ctx.body as z.infer<typeof A.AdminReasonBody>;
  inviteConfig(ctx);
  const token = randomToken(32);
  await ctx.db.call('admin_invite_rotate', {
    p_user: id,
    p_token_hash: await sha256Bytea(token),
    p_reason: body.reason,
  });
  await queueInviteEmail(ctx, id, token);
  return { data: adminRow(await adminRowById(ctx, id)) };
}

async function unlock(ctx: RouteCtx) {
  const id = String(ctx.params.id);
  const body = ctx.body as z.infer<typeof A.AdminReasonBody>;
  const target = await adminRowById(ctx, id);
  const hash = await emailLookupHash(ctx.rt, String(target.email));
  await ctx.db.call('admin_unlock', { p_user: id, p_reason: body.reason, p_email_hash: hash });
  return { data: adminRow(await adminRowById(ctx, id)) };
}

// ── ADM-20 Settings ──────────────────────────────────────────────────────────

/**
 * Contract setting keys whose storage differs (API_CONTRACTS §4.2 vs DATABASE_AND_RLS_PLAN):
 * `referral.risk_threshold` is 0–1 in the contract and 0–100 in `app_settings` (the unit of
 * `referrals.risk_score`); `referral.max_rewards_per_year` is the plan limit
 * `referral_rewards_per_year` the referral reward step reads (both plans).
 */
const RISK_THRESHOLD = 'referral.risk_threshold';
const REWARDS_PER_YEAR = 'referral.max_rewards_per_year';

function riskToContract(value: unknown): unknown {
  const n = num(value);
  return n === null ? (value ?? null) : Math.round((n > 1 ? n / 100 : n) * 10000) / 10000;
}

async function settingsSnapshot(ctx: RouteCtx) {
  const s = obj(await ctx.db.call('settings_get'));
  const limits = obj(s.plan_limits);
  const appSettings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj(s.app_settings)))
    appSettings[key] = obj(value).value ?? null;
  if (RISK_THRESHOLD in appSettings)
    appSettings[RISK_THRESHOLD] = riskToContract(appSettings[RISK_THRESHOLD]);
  const rewards =
    obj(limits.pro).referral_rewards_per_year ?? obj(limits.free).referral_rewards_per_year;
  if (rewards !== undefined) appSettings[REWARDS_PER_YEAR] = rewards;
  return { limits, appSettings };
}

async function settings(ctx: RouteCtx) {
  const { limits, appSettings } = await settingsSnapshot(ctx);
  return {
    data: {
      plan_limits: { free: obj(limits.free), pro: obj(limits.pro) },
      app_settings: appSettings,
    },
  };
}

async function patchPlanLimit(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.PlanLimitPatchBody>;
  const before =
    obj(obj(obj(await ctx.db.call('settings_get')).plan_limits)[body.plan])[body.key] ?? null;
  const out = obj(
    await ctx.db.call('plan_limits_update', {
      p_plan: body.plan,
      p_key: body.key,
      p_value: body.value,
      p_reason: body.reason,
    }),
  );
  return { data: { key: body.key, before, after: out.value ?? null } };
}

async function patchConfig(ctx: RouteCtx) {
  const key = String(ctx.params.key);
  const body = ctx.body as z.infer<typeof A.ConfigPatchBody>;
  if (!A.appSettingValueValid(key, body.value)) {
    throw fieldError(
      key in A.APP_SETTING_VALUE_SCHEMAS ? 'value' : 'key',
      key in A.APP_SETTING_VALUE_SCHEMAS ? 'value_out_of_range' : 'unknown_setting',
    );
  }
  const before = (await settingsSnapshot(ctx)).appSettings[key] ?? null;
  if (key === REWARDS_PER_YEAR) {
    let after: unknown = null;
    for (const plan of ['free', 'pro'] as const) {
      const out = obj(
        await ctx.db.call('plan_limits_update', {
          p_plan: plan,
          p_key: 'referral_rewards_per_year',
          p_value: body.value,
          p_reason: body.reason,
        }),
      );
      after = out.value ?? null;
    }
    return { data: { key, before, after } };
  }
  const value = key === RISK_THRESHOLD ? Math.round(Number(body.value) * 100) : body.value;
  const out = obj(
    await ctx.db.call('settings_update', { p_key: key, p_value: value, p_reason: body.reason }),
  );
  const after = key === RISK_THRESHOLD ? riskToContract(out.value) : (out.value ?? null);
  return { data: { key, before, after } };
}

export const systemRoutes = defineRoutes({
  'GET /health/summary': { rate: 'R', handle: healthSummary },
  'GET /health/history': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.HealthHistoryQuery>;
      const out = obj(
        await ctx.db.call('health_history', { p_component: query.component, p_range: query.range }),
      );
      return {
        data: arr(out.rows).map((r) => ({
          checked_at: r.checked_at,
          component: r.component,
          status: r.status,
          latency_ms: num(r.latency_ms) === null ? null : count(r.latency_ms),
          detail_code: str(r.detail_code),
          checked_by: r.checked_by === 'admin' ? 'admin' : 'cron',
        })),
      };
    },
  },
  'POST /health/run': { rate: 'X', handle: healthRun },
  'GET /health/app-versions': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AppVersionsQuery>;
      const out = obj(await ctx.db.call('app_versions_breakdown', { p_range: query.range }));
      return {
        data: {
          versions: arr(out.versions).map((v) => ({
            platform: v.platform,
            app_version: v.app_version,
            installations: count(v.installations ?? v.active_installs),
            sync_error_rate: Math.min(1, Math.max(0, num(v.sync_error_rate) ?? 0)),
            below_minimum: v.below_minimum === true,
          })),
        },
      };
    },
  },
  'GET /health/cron': {
    rate: 'R',
    async handle(ctx) {
      const out = obj(await ctx.db.call('cron_status'));
      const lag = num(out.worker_lag_s);
      return {
        data: {
          schedules: arr(out.jobs).map((j) => ({
            name: str(j.name) ?? 'unknown',
            last_run_at: str(j.last_start),
            duration_ms: num(j.last_duration_ms) === null ? null : count(j.last_duration_ms),
            status: str(j.last_status),
          })),
          worker_lag_s: lag === null ? null : Math.max(0, lag),
        },
      };
    },
  },
  'GET /admins': {
    rate: 'R',
    async handle(ctx) {
      return { data: arr(obj(await ctx.db.call('admins_list')).rows).map(adminRow) };
    },
  },
  'POST /admins/invite': { rate: 'X', handle: invite },
  'PATCH /admins/:id': {
    rate: 'X',
    async handle(ctx) {
      const id = String(ctx.params.id);
      const body = ctx.body as z.infer<typeof A.AdminRoleBody>;
      await ctx.db.call('admin_update_role', {
        p_user: id,
        p_role: body.role,
        p_reason: body.reason,
      });
      return { data: adminRow(await adminRowById(ctx, id)) };
    },
  },
  'POST /admins/:id/disable': {
    rate: 'X',
    async handle(ctx) {
      const id = String(ctx.params.id);
      const body = ctx.body as z.infer<typeof A.AdminStatusBody>;
      await ctx.db.call('admin_disable', { p_user: id, p_reason: body.reason });
      await setAdminBan(ctx, id, true, body.reason);
      return { data: adminRow(await adminRowById(ctx, id)) };
    },
  },
  'POST /admins/:id/enable': {
    rate: 'X',
    async handle(ctx) {
      const id = String(ctx.params.id);
      const body = ctx.body as z.infer<typeof A.AdminStatusBody>;
      await ctx.db.call('admin_enable', { p_user: id, p_reason: body.reason });
      await setAdminBan(ctx, id, false, body.reason);
      return { data: adminRow(await adminRowById(ctx, id)) };
    },
  },
  'POST /admins/:id/revoke-sessions': {
    rate: 'X',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AdminReasonBody>;
      const out = obj(
        await ctx.db.call('admin_sessions_revoke_all', {
          p_user: String(ctx.params.id),
          p_reason: body.reason,
        }),
      );
      return { data: { ended_sessions: count(out.sessions_ended) } };
    },
  },
  'POST /admins/:id/resend-invite': { rate: 'X', handle: resendInvite },
  'POST /admins/:id/reset-mfa': { rate: 'X', handle: resetMfa },
  'POST /admins/:id/unlock': { rate: 'X', handle: unlock },
  'GET /settings': { rate: 'R', handle: settings },
  'PATCH /settings/plan-limits': { rate: 'X', handle: patchPlanLimit },
  'PATCH /settings/config/:key': { rate: 'X', handle: patchConfig },
  'GET /search': {
    rate: 'S',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AdminSearchQuery>;
      const out = obj(await ctx.db.call('command_search', { p_q: query.q }));
      return {
        data: {
          results: arr(out.results).map((r) => ({
            type: r.type,
            id: str(r.id) ?? '',
            label: str(r.label) ?? '',
            route: r.route,
          })),
        },
      };
    },
  },
});
