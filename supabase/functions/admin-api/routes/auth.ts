/**
 * ADM-00 sign-in routes (API_CONTRACTS §12.3; BACKOFFICE_PLAN §3.2–§3.5):
 * - BFF only (no user session): `POST /auth/preflight`, `POST /auth/attempt`,
 *   `POST /auth/invite/redeem` → the service-role functions `login_preflight`,
 *   `login_attempt_record`, `invite_redeem`;
 * - aal1 admin JWT: `GET /auth/status` → `auth_status`; `POST /auth/recovery-code/redeem` →
 *   `recovery_code_consume`, then the TOTP factors are deleted (service client), and every active
 *   super admin gets a security email (JOB-31) when the email API is configured.
 *
 * The raw email never reaches admin-api: the BFF sends `email_hash = sha256(lower(trim(email)))` and
 * `ip_hash = sha256(ip)` (it holds no pepper). The digest is matched against the admin identities
 * so lockouts apply, and both digests are peppered here (`HMAC(PII_LOOKUP_PEPPER, digest)`) before
 * they key a rate limit or reach an audit row; an unknown hash gets exactly the answer an unknown
 * email gets.
 */
import type { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError, mapDbError } from '../../_shared/errors.ts';
import { supabaseAuditWriter } from '../../_shared/services/audit.ts';
import { callServiceAdminFn } from '../lib/db.ts';
import { count, obj } from '../lib/map.ts';
import {
  adminEmailForHash,
  deleteMfaFactors,
  emailConfigured,
  enqueueEmail,
  pepperedSubject,
  poke,
  sha256Bytea,
} from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import { recoveryCodeDigest } from '../services/recovery-codes.ts';

async function preflight(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AuthPreflightBody>;
  const email = await adminEmailForHash(ctx.rt, ctx.log, body.email_hash);
  const out = obj(
    await callServiceAdminFn(ctx.rt.system, 'login_preflight', {
      p_email: email,
      p_email_hash: await pepperedSubject(ctx.rt, body.email_hash),
      p_ip_hash: await pepperedSubject(ctx.rt, body.ip_hash),
    }),
  );
  return {
    data: {
      allowed: out.allowed === true,
      ...(typeof out.retry_after === 'number' ? { retry_after: count(out.retry_after) } : {}),
      ...(out.locked === true ? { locked: true } : {}),
    },
  };
}

async function attempt(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AuthAttemptBody>;
  const email = await adminEmailForHash(ctx.rt, ctx.log, body.email_hash);
  await callServiceAdminFn(ctx.rt.system, 'login_attempt_record', {
    p_email: email,
    p_email_hash: await pepperedSubject(ctx.rt, body.email_hash),
    p_ip_hash: await pepperedSubject(ctx.rt, body.ip_hash),
    p_kind: body.kind,
    p_success: body.success,
  });
  return { data: { recorded: true } };
}

async function inviteRedeem(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.InviteRedeemBody>;
  const out = obj(
    await callServiceAdminFn(ctx.rt.system, 'invite_redeem', {
      p_token_hash: await sha256Bytea(body.token),
    }),
  );
  return { data: { email: out.email, accepted: true } };
}

async function recoveryRedeem(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.RecoveryCodeRedeemBody>;
  const pepper = ctx.rt.env.recoveryCodePepper;
  if (pepper === undefined) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'admin_recovery_codes', credential_keys: ['RECOVERY_CODE_PEPPER'] },
    });
  }
  const adminId = ctx.adminId ?? '';
  await ctx.db.call('recovery_code_consume', {
    p_code_hash: await recoveryCodeDigest(pepper, body.code),
  });
  const audit = supabaseAuditWriter(ctx.rt.system);
  let removed: number;
  try {
    removed = await deleteMfaFactors(ctx.rt, adminId);
  } catch (error) {
    await audit.append({
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.mfa_recovery_used',
      targetType: 'admin_user',
      targetId: adminId,
      targetUserId: null,
      reason: 'recovery code redeemed; factor deletion failed',
      result: 'failure',
      details: { partial: true, step: 'delete_factors' },
      correlationId: ctx.c.get('correlationId'),
    });
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { partial: true, step: 'delete_factors' },
      cause: error,
    });
  }
  if (emailConfigured(ctx.rt)) {
    const { data, error } = await ctx.rt.system
      .from('admin_users')
      .select('user_id')
      .eq('role', 'super_admin')
      .eq('status', 'active');
    if (error !== null) throw mapDbError(error);
    for (const row of (data ?? []) as { user_id: string }[]) {
      await enqueueEmail(ctx.rt, {
        templateKey: 'admin_security_recovery_used',
        recipient: { type: 'admin_user', id: row.user_id },
        locale: 'tr',
        params: { subject_admin_id: adminId },
        unique: ctx.idempotencyKey ?? crypto.randomUUID(),
        correlationId: ctx.c.get('correlationId'),
      });
    }
    await poke(ctx.rt, ctx.log, 'admin_security_email');
  } else {
    ctx.log.warn('admin_security_email_skipped', { reason: 'external_credential_required' });
  }
  return { data: { factors_removed: removed, reenrol_required: true } };
}

export const authRoutes = defineRoutes({
  'POST /auth/preflight': { rate: 'A', handle: preflight },
  'POST /auth/attempt': { rate: 'A', handle: attempt },
  'GET /auth/status': {
    rate: 'A',
    async handle(ctx) {
      const out = obj(await ctx.db.call('auth_status'));
      return {
        data: {
          is_admin: out.is_admin === true,
          status: out.status ?? null,
          mfa_verified_factors: count(out.mfa_verified_factors),
        },
      };
    },
  },
  'POST /auth/invite/redeem': { rate: 'A', handle: inviteRedeem },
  'POST /auth/recovery-code/redeem': { rate: 'X', handle: recoveryRedeem },
});
