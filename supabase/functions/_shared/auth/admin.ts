/**
 * Admin authentication for `admin-api` and the admin path of `health` (API_CONTRACTS §3, §12.1;
 * BACKOFFICE_PLAN §2.5; SECURITY_AND_PRIVACY_PLAN CTL-3.8; IMPLEMENTATION_PLAN T-3.03).
 *
 * Order: no browser `Origin` → BFF key (`x-da-bff` = `ADMIN_BFF_SECRET`, constant time) → JWT
 * verified → dedicated admin identity (`app_metadata.da_kind='admin'`) → `aal2` → the SQL gate
 * `admin_api.authorize(permission)` called with the admin's JWT and the `x-da-admin-gateway`
 * header, which re-checks the active `admin_users` row, the `admin_sessions` idle/absolute limits,
 * the role permission and the mutation rate limit.
 */
import type { MiddlewareHandler } from 'hono';
import { AppError, mapDbError } from '../errors.ts';
import { secretsEqual } from '../crypto/hmac.ts';
import { adminGatewayClient, type ClientConfig } from '../db/clients.ts';
import { DB_FN, rpcRaw } from '../db/functions.ts';
import type { AdminAuth, AppContext, AppEnv, VerifiedClaims } from '../http/context.ts';
import { bearerToken, claimsAal, isAdminIdentity, type TokenVerifier } from './user.ts';

/** The SQL permission gate (`admin_api.authorize`), injected so tests never need a database. */
export interface AdminGate {
  authorize(jwt: string, permission: string): Promise<void>;
}

export interface AdminAuthOptions {
  readonly verifier: TokenVerifier;
  readonly gate: AdminGate;
  /** `ADMIN_BFF_SECRET`; `undefined` refuses every request. */
  readonly bffSecret: string | undefined;
  /** Skip the BFF key (the `health` admin path is called by `admin-api`, which already checked it). */
  readonly requireBff?: boolean;
}

/**
 * Maps the SQL gate's `42501` messages (DATABASE_AND_RLS_PLAN §6.8, BACKOFFICE_PLAN §2.6) to API codes.
 */
export function mapAdminGateError(message: string, permission: string): AppError {
  const m = message.toLowerCase();
  if (m.includes('aal2')) return new AppError('AAL2_REQUIRED');
  if (m.includes('session_expired') || m.includes('session_revoked')) {
    return new AppError('AUTH_REQUIRED', { details: { reason: 'admin_session_expired' } });
  }
  if (m.includes('unauthenticated'))
    return new AppError('AUTH_REQUIRED', { details: { reason: 'invalid_token' } });
  if (m.includes('gateway')) return new AppError('FORBIDDEN', { details: { reason: 'gateway' } });
  if (m.includes('locked')) return new AppError('FORBIDDEN', { details: { reason: 'locked' } });
  if (m.includes('rate')) return new AppError('RATE_LIMITED');
  return new AppError('FORBIDDEN', { details: { permission } });
}

async function checkBff(c: AppContext, options: AdminAuthOptions): Promise<void> {
  if (options.requireBff === false) return;
  const provided = c.req.header('x-da-bff');
  const ok =
    options.bffSecret !== undefined &&
    options.bffSecret !== '' &&
    provided !== undefined &&
    (await secretsEqual(provided, options.bffSecret));
  if (!ok) throw new AppError('AUTH_REQUIRED', { details: { reason: 'bff_required' } });
}

/** Verifies an admin request and runs the SQL permission gate. */
export async function authenticateAdmin(
  c: AppContext,
  options: AdminAuthOptions,
  permission: string,
): Promise<AdminAuth> {
  if (c.req.header('Origin') !== undefined) {
    throw new AppError('FORBIDDEN', { details: { reason: 'browser_origin' } });
  }
  await checkBff(c, options);
  const jwt = bearerToken(c.req.header('Authorization'));
  if (jwt === null) throw new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } });
  const claims: VerifiedClaims = await options.verifier.verify(jwt);
  if (!isAdminIdentity(claims))
    throw new AppError('FORBIDDEN', { details: { reason: 'not_admin' } });
  if (claimsAal(claims) !== 'aal2') throw new AppError('AAL2_REQUIRED');
  await options.gate.authorize(jwt, permission);
  return {
    adminId: claims.sub.toLowerCase(),
    sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
    jwt,
    role: typeof claims.admin_role === 'string' ? claims.admin_role : null,
  };
}

export function requireAdmin(
  options: AdminAuthOptions,
  permission: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const admin = await authenticateAdmin(c, options, permission);
    c.set('admin', admin);
    c.set('log', c.get('log').child({ admin_id: admin.adminId }));
    await next();
  };
}

/** `admin_api.authorize(p_permission)` through the gateway header (the supabase-backed gate). */
export function supabaseAdminGate(options: {
  readonly gatewaySecret: string | undefined;
  readonly clientConfig: ClientConfig;
}): AdminGate {
  return {
    async authorize(jwt, permission) {
      if (options.gatewaySecret === undefined || options.gatewaySecret === '') {
        throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
          details: { feature: 'admin', credential_keys: ['ADMIN_GATEWAY_SECRET'] },
        });
      }
      const client = adminGatewayClient(jwt, options.gatewaySecret, options.clientConfig);
      const { error } = await rpcRaw<unknown>(client, DB_FN.adminAuthorize, {
        p_permission: permission,
      });
      if (error === null) return;
      if (
        error.code === '42501' ||
        /admin|aal2|gateway|forbidden|session/i.test(error.message ?? '')
      ) {
        throw mapAdminGateError(error.message ?? '', permission);
      }
      throw mapDbError(error);
    },
  };
}
