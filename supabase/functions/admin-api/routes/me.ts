/**
 * ADM-00 own-account routes (API_CONTRACTS §12.3; BACKOFFICE_PLAN §3.4, §3.7, §16 #4, #41):
 * `GET /me` (the `admin_me` context itself), `GET /me/sessions` (`sessions_list_own`: the caller's
 * rows only, never `ip_hash` or the raw user agent), `GET/PATCH /preferences`
 * (`admin_preferences_get` / `admin_preferences_set`) and `POST /me/recovery-codes`
 * (`recovery_codes_store`: 10 fresh codes returned once; step-up once codes exist). The backup
 * factor (BACKOFFICE_PLAN §3.3): `POST /me/mfa-factors` confirms a TOTP factor the backoffice just
 * enrolled and verified with the admin's own Auth session (at most two verified factors; an extra
 * one is removed again) and `DELETE /me/mfa-factors/:factorId` removes one (step-up; one must stay).
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError } from '../../_shared/errors.ts';
import { arr, count, type Json, obj, str } from '../lib/map.ts';
import { deleteMfaFactor, verifiedTotpFactorIds } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import { auditWrite } from '../middleware/audit.ts';
import { generateRecoveryCodes, recoveryCodeDigest } from '../services/recovery-codes.ts';

const PERMISSIONS = new Set<string>(A.ADMIN_PERMISSION_VALUES);

/** `admin_preferences` row → the ADM-00 preferences shape (theme `system` renders light). */
export function mapPreferences(value: unknown) {
  const p = obj(value);
  const locale = str(p.locale) ?? 'tr-TR';
  return {
    theme: p.theme === 'dark' ? 'dark' : 'light',
    locale: locale.toLowerCase().startsWith('en') ? 'en' : 'tr',
    timezone: str(p.timezone) ?? 'Europe/Istanbul',
    density: p.density === 'compact' ? 'compact' : 'comfortable',
    table_prefs: obj(p.table_prefs),
    dashboard_range: ['24h', '7d', '30d', '90d'].includes(str(p.dashboard_range) ?? '')
      ? p.dashboard_range
      : '7d',
    recent_items: arr(p.recent_items).slice(0, 10),
    sidebar_collapsed: p.sidebar_collapsed === true,
  };
}

function mapMe(me: Json) {
  const admin = obj(me.admin);
  const session = obj(me.session);
  return {
    admin: {
      id: admin.id,
      email: admin.email,
      display_name: str(admin.display_name),
      role: admin.role,
      status: admin.status,
      mfa_enrolled: admin.mfa_enrolled === true,
      mfa_factor_count: count(admin.mfa_factor_count),
      recovery_codes_remaining: count(admin.recovery_codes_remaining),
    },
    permissions: (Array.isArray(me.permissions) ? me.permissions : []).filter(
      (p): p is string => typeof p === 'string' && PERMISSIONS.has(p),
    ),
    session: {
      id: session.id,
      idle_expires_at: session.idle_expires_at,
      absolute_expires_at: session.absolute_expires_at,
      step_up_valid_until: str(session.step_up_valid_until),
    },
    preferences: mapPreferences(me.preferences),
  };
}

async function recoveryCodes(ctx: RouteCtx) {
  const pepper = ctx.rt.env.recoveryCodePepper;
  if (pepper === undefined) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'admin_recovery_codes', credential_keys: ['RECOVERY_CODE_PEPPER'] },
    });
  }
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => recoveryCodeDigest(pepper, code)));
  await ctx.db.call('recovery_codes_store', { p_code_hashes: hashes });
  return {
    data: { codes, generated_at: new Date(ctx.rt.now()).toISOString() },
    status: 201 as const,
  };
}

async function patchPreferences(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AdminPreferencesPatch>;
  const out = await ctx.db.call('admin_preferences_set', {
    p_theme: body.theme ?? null,
    p_locale: body.locale ?? null,
    p_table_prefs: body.table_prefs ?? null,
    p_dashboard_range: body.dashboard_range ?? null,
    p_timezone: body.timezone ?? null,
    p_density: body.density ?? null,
    p_recent_items: body.recent_items ?? null,
    p_sidebar_collapsed: body.sidebar_collapsed ?? null,
  });
  return { data: mapPreferences(out) };
}

function ownAdminId(ctx: RouteCtx): string {
  if (ctx.adminId === null) throw new AppError('AUTH_REQUIRED');
  return ctx.adminId;
}

async function confirmFactor(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.MfaFactorConfirmBody>;
  const adminId = ownAdminId(ctx);
  const verified = await verifiedTotpFactorIds(ctx.rt, adminId);
  if (!verified.includes(body.factor_id)) {
    throw new AppError('STATE_CONFLICT', { details: { reason: 'factor_not_verified' } });
  }
  if (verified.length > A.MAX_ADMIN_MFA_FACTORS) {
    await deleteMfaFactor(ctx.rt, adminId, body.factor_id);
    throw new AppError('STATE_CONFLICT', { details: { reason: 'max_factors' } });
  }
  await auditWrite(ctx.db, {
    action: 'admin.mfa_factor_added',
    targetType: 'admin_user',
    targetId: adminId,
    reason: 'backup TOTP factor enrolled',
    result: 'success',
    details: { factor_id: body.factor_id, verified_factors: verified.length },
    idempotencyKey: ctx.idempotencyKey,
  });
  return {
    data: { factor_id: body.factor_id, verified_factors: verified.length },
    status: 201 as const,
  };
}

async function removeFactor(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.MfaFactorRemoveBody>;
  const adminId = ownAdminId(ctx);
  const factorId = String(ctx.params.factorId);
  const verified = await verifiedTotpFactorIds(ctx.rt, adminId);
  if (!verified.includes(factorId)) throw new AppError('NOT_FOUND');
  if (verified.length < 2) {
    throw new AppError('STATE_CONFLICT', { details: { reason: 'last_factor' } });
  }
  await deleteMfaFactor(ctx.rt, adminId, factorId);
  await auditWrite(ctx.db, {
    action: 'admin.mfa_factor_removed',
    targetType: 'admin_user',
    targetId: adminId,
    reason: body.reason,
    result: 'success',
    details: { factor_id: factorId, verified_factors: verified.length - 1 },
    idempotencyKey: ctx.idempotencyKey,
  });
  return { data: { factor_id: factorId, verified_factors: verified.length - 1 } };
}

export const meRoutes = defineRoutes({
  'GET /me': {
    rate: 'R',
    handle(ctx) {
      return Promise.resolve({ data: mapMe(ctx.context?.me ?? {}) });
    },
  },
  'GET /me/sessions': {
    rate: 'R',
    async handle(ctx) {
      return { data: arr(await ctx.db.call('sessions_list_own')).slice(0, 20) };
    },
  },
  'GET /preferences': {
    rate: 'R',
    async handle(ctx) {
      return { data: mapPreferences(await ctx.db.call('admin_preferences_get')) };
    },
  },
  'PATCH /preferences': { rate: 'M', handle: patchPreferences },
  'POST /me/recovery-codes': {
    rate: 'X',
    replay: 'refuse',
    // BACKOFFICE_PLAN §3.4: the first set (no unused codes yet) follows the MFA enrolment
    // directly; regenerating an existing set needs a fresh step-up (the SQL rule is the same).
    stepUp: (context) => context.recoveryCodesRemaining > 0,
    handle: recoveryCodes,
  },
  'POST /me/mfa-factors': { rate: 'X', handle: confirmFactor },
  'DELETE /me/mfa-factors/:factorId': { rate: 'X', handle: removeFactor },
});
