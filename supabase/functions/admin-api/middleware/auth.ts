/**
 * admin-api authentication steps (BACKOFFICE_PLAN §2.5 steps 2–3; API_CONTRACTS §12.1, §3):
 * - the BFF key `x-da-bff` (constant-time compare with `ADMIN_BFF_SECRET`) on every route, since
 *   admin-api is server-to-server only (browser `Origin` headers are refused by the app factory);
 * - the admin JWT, verified in code (`verify_jwt=false`): signature, dedicated admin identity
 *   (`app_metadata.da_kind='admin'`) and `aal2`, except on the aal1 allow-list
 *   (`GET /auth/status`, `POST /auth/recovery-code/redeem`).
 */
import {
  bearerToken,
  claimsAal,
  isAdminIdentity,
  type TokenVerifier,
} from '../../_shared/auth/user.ts';
import { secretsEqual } from '../../_shared/crypto/hmac.ts';
import { AppError } from '../../_shared/errors.ts';
import type { Aal, AppContext, VerifiedClaims } from '../../_shared/http/context.ts';

export async function checkBffKey(c: AppContext, bffSecret: string | undefined): Promise<void> {
  const provided = c.req.header('x-da-bff');
  const ok =
    bffSecret !== undefined &&
    bffSecret !== '' &&
    provided !== undefined &&
    (await secretsEqual(provided, bffSecret));
  if (!ok) throw new AppError('AUTH_REQUIRED', { details: { reason: 'bff_required' } });
}

export interface AdminIdentity {
  readonly jwt: string;
  readonly claims: VerifiedClaims;
  readonly adminId: string;
  readonly aal: Aal;
  readonly sessionId: string | null;
}

/** Verifies the bearer token of an admin identity; `requireAal2=false` accepts aal1. */
export async function verifyAdminIdentity(
  c: AppContext,
  verifier: TokenVerifier,
  requireAal2: boolean,
): Promise<AdminIdentity> {
  const jwt = bearerToken(c.req.header('Authorization'));
  if (jwt === null) throw new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } });
  const claims = await verifier.verify(jwt);
  if (!isAdminIdentity(claims))
    throw new AppError('FORBIDDEN', { details: { reason: 'not_admin' } });
  const aal = claimsAal(claims);
  if (requireAal2 && aal !== 'aal2') throw new AppError('AAL2_REQUIRED');
  return {
    jwt,
    claims,
    adminId: claims.sub.toLowerCase(),
    aal,
    sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
  };
}
