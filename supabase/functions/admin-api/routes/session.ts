/**
 * ADM-00 session lifecycle (API_CONTRACTS §12.3; BACKOFFICE_PLAN §3.2 step 8, §3.3, §3.7):
 * - `POST /session/start` → `admin_session_start(p_ip_hash, p_user_agent)`: creates or refreshes the
 *   `admin_sessions` row of the JWT `session_id` (absolute expiry now + 12 h), activates an invited
 *   admin on the first start; runs before the session context exists;
 * - `POST /session/heartbeat` → the context call `admin_me(true)` → `{idle_expires_at}`;
 * - `POST /session/step-up` → `admin_session_step_up()` after the TOTP re-check in the backoffice;
 * - `POST /session/logout` → `admin_session_end('current')` + Auth sign-out (local);
 * - `POST /session/logout-all` → `admin_session_end('all' | 'others')` + Auth sign-out (global |
 *   others).
 * The client IP and user agent are forwarded by the backoffice server (`X-Forwarded-For` or
 * `X-DA-Client-IP`; `X-DA-User-Agent`, or `X-DA-Client-UA`); only the peppered IP hash is stored.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { clientIp, hashIdBytea } from '../../_shared/crypto/hash.ts';
import { count, obj, str } from '../lib/map.ts';
import { authSignOut } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

const PERMISSIONS = new Set<string>(A.ADMIN_PERMISSION_VALUES);

async function sessionStart(ctx: RouteCtx) {
  const ip =
    ctx.c.req.header('x-da-client-ip')?.trim() || clientIp(ctx.c.req.header('x-forwarded-for'));
  const ua =
    (ctx.c.req.header('x-da-user-agent') ?? ctx.c.req.header('x-da-client-ua'))?.trim() ?? null;
  const ipHash =
    ip !== null && ip !== '' && ctx.rt.env.hashPepper !== ''
      ? await hashIdBytea({ HASH_PEPPER: ctx.rt.env.hashPepper }, `admin_ip:${ip}`)
      : null;
  const out = obj(
    await ctx.db.call('admin_session_start', {
      p_ip_hash: ipHash,
      p_user_agent: ua === null || ua === '' ? null : ua.slice(0, 300),
    }),
  );
  return {
    data: {
      admin: out.admin,
      // Role permissions the contract does not know yet are not forwarded to the backoffice.
      permissions: (Array.isArray(out.permissions) ? out.permissions : []).filter(
        (p): p is string => typeof p === 'string' && PERMISSIONS.has(p),
      ),
      idle_expires_at: out.idle_expires_at,
      absolute_expires_at: out.absolute_expires_at,
    },
  };
}

async function logout(ctx: RouteCtx) {
  const out = obj(await ctx.db.call('admin_session_end', { p_scope: 'current', p_reason: null }));
  if (ctx.jwt !== null) await authSignOut(ctx.rt, ctx.log, ctx.jwt, 'local');
  return { data: { ended_sessions: count(out.ended) } };
}

async function logoutAll(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.SessionLogoutAllBody>;
  const scope = body.scope ?? 'all';
  const out = obj(
    await ctx.db.call('admin_session_end', {
      p_scope: scope,
      p_reason: scope === 'all' ? 'admin signed out everywhere' : 'admin signed out other sessions',
    }),
  );
  if (ctx.jwt !== null) {
    await authSignOut(ctx.rt, ctx.log, ctx.jwt, scope === 'all' ? 'global' : 'others');
  }
  return { data: { ended_sessions: count(out.ended) } };
}

export const sessionRoutes = defineRoutes({
  'POST /session/start': { rate: 'M', skipContext: true, handle: sessionStart },
  'POST /session/heartbeat': {
    rate: 'M',
    handle(ctx) {
      return Promise.resolve({
        data: { idle_expires_at: ctx.context?.session.idle_expires_at ?? null },
      });
    },
  },
  'POST /session/step-up': {
    rate: 'M',
    async handle(ctx) {
      const out = obj(await ctx.db.call('admin_session_step_up'));
      return { data: { step_up_valid_until: str(out.step_up_valid_until) } };
    },
  },
  'POST /session/logout': { rate: 'M', handle: logout },
  'POST /session/logout-all': { rate: 'M', handle: logoutAll },
});
