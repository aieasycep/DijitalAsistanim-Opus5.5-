/**
 * End-user authentication (API_CONTRACTS §3, IMPLEMENTATION_PLAN T-3.03).
 *
 * The access token is verified with supabase-js `auth.getClaims()` (JWKS for asymmetric keys, an
 * Auth round trip for legacy symmetric keys). When that path fails for infrastructure reasons
 * (network, JWKS fetch) a `jose` JWKS verifier checks the signature, issuer, audience and expiry.
 * The result is `{userId, aal, sessionId}`; dedicated admin identities
 * (`app_metadata.da_kind='admin'`) are rejected with `FORBIDDEN {reason:'admin_identity'}` (R-08),
 * anonymous sessions and non-`authenticated` roles with `AUTH_REQUIRED`.
 */
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../errors.ts';
import type { DbClient } from '../db/clients.ts';
import type { Aal, AppEnv, UserAuth, VerifiedClaims } from '../http/context.ts';

export interface TokenVerifier {
  /** Resolves the verified claims or throws `AppError('AUTH_REQUIRED')`. */
  verify(jwt: string): Promise<VerifiedClaims>;
}

/** Raised by a verifier when it could not decide (network, JWKS unavailable): try the next one. */
export class VerifierUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('token_verifier_unavailable', cause === undefined ? undefined : { cause });
    this.name = 'VerifierUnavailableError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authRequired(reason: string): AppError {
  return new AppError('AUTH_REQUIRED', { details: { reason } });
}

function asClaims(payload: JWTPayload | Record<string, unknown>): VerifiedClaims {
  const sub = payload.sub;
  if (typeof sub !== 'string' || !UUID_RE.test(sub)) throw authRequired('invalid_subject');
  return payload as VerifiedClaims;
}

/** supabase-js `auth.getClaims(jwt)`. */
export function supabaseClaimsVerifier(client: DbClient): TokenVerifier {
  return {
    async verify(jwt) {
      let result: Awaited<ReturnType<DbClient['auth']['getClaims']>>;
      try {
        result = await client.auth.getClaims(jwt);
      } catch (error) {
        throw new VerifierUnavailableError(error);
      }
      const { data, error } = result;
      if (error !== null) {
        const name = (error as { name?: string }).name ?? '';
        const status = (error as { status?: number }).status ?? 0;
        if (name === 'AuthRetryableFetchError' || status >= 500)
          throw new VerifierUnavailableError(error);
        throw authRequired('invalid_token');
      }
      if (data === null) throw authRequired('invalid_token');
      return asClaims(data.claims as unknown as Record<string, unknown>);
    },
  };
}

export interface JwksVerifierOptions {
  /** `createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))` in production. */
  readonly jwks: JWTVerifyGetKey;
  /** `${SUPABASE_URL}/auth/v1`. */
  readonly issuer: string;
  readonly audience?: string;
  readonly clockToleranceSeconds?: number;
  readonly currentDate?: () => Date;
}

/** `jose` JWKS verification (fallback path). */
export function jwksVerifier(options: JwksVerifierOptions): TokenVerifier {
  return {
    async verify(jwt) {
      try {
        const { payload } = await jwtVerify(jwt, options.jwks, {
          issuer: options.issuer,
          audience: options.audience ?? 'authenticated',
          clockTolerance: options.clockToleranceSeconds ?? 5,
          algorithms: ['ES256', 'RS256', 'EdDSA'],
          ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate() }),
        });
        return asClaims(payload);
      } catch (error) {
        if (error instanceof AppError) throw error;
        const code = (error as { code?: string }).code ?? '';
        if (
          code === 'ERR_JWKS_TIMEOUT' ||
          code === 'ERR_JOSE_GENERIC' ||
          error instanceof TypeError
        ) {
          throw new VerifierUnavailableError(error);
        }
        throw authRequired(code === 'ERR_JWT_EXPIRED' ? 'token_expired' : 'invalid_token');
      }
    },
  };
}

export function remoteJwksVerifier(supabaseUrl: string): TokenVerifier {
  const base = supabaseUrl.replace(/\/+$/, '');
  return jwksVerifier({
    jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
    }),
    issuer: `${base}/auth/v1`,
  });
}

/** Tries `primary`; falls back only when it reports `VerifierUnavailableError`. */
export function chainVerifiers(primary: TokenVerifier, fallback: TokenVerifier): TokenVerifier {
  return {
    async verify(jwt) {
      try {
        return await primary.verify(jwt);
      } catch (error) {
        if (!(error instanceof VerifierUnavailableError)) throw error;
        try {
          return await fallback.verify(jwt);
        } catch (fallbackError) {
          if (fallbackError instanceof VerifierUnavailableError) {
            throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'auth_unavailable' } });
          }
          throw fallbackError;
        }
      }
    },
  };
}

export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function isAdminIdentity(claims: VerifiedClaims): boolean {
  return claims.app_metadata?.da_kind === 'admin';
}

export function claimsAal(claims: VerifiedClaims): Aal {
  return claims.aal === 'aal2' ? 'aal2' : 'aal1';
}

/** Builds the request identity from verified claims (end users only). */
export function toUserAuth(jwt: string, claims: VerifiedClaims): UserAuth {
  if (claims.role !== undefined && claims.role !== 'authenticated')
    throw authRequired('invalid_role');
  if (claims.is_anonymous === true) throw authRequired('anonymous_session');
  if (isAdminIdentity(claims))
    throw new AppError('FORBIDDEN', { details: { reason: 'admin_identity' } });
  return {
    userId: claims.sub.toLowerCase(),
    aal: claimsAal(claims),
    sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
    jwt,
    claims,
  };
}

export async function authenticateUser(
  verifier: TokenVerifier,
  authorization: string | undefined,
): Promise<UserAuth> {
  const jwt = bearerToken(authorization);
  if (jwt === null) throw authRequired('missing_token');
  const claims = await verifier.verify(jwt);
  return toUserAuth(jwt, claims);
}

export interface RequireUserOptions {
  /** Peppered pseudonym for logs (`logHash(env, userId)`); never the raw id. */
  readonly userHash: (userId: string) => Promise<string>;
}

/** Hono middleware: verifies the bearer token and sets `c.var.auth`. */
export function requireUser(
  verifier: TokenVerifier,
  options: RequireUserOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = await authenticateUser(verifier, c.req.header('Authorization'));
    const userHash = await options.userHash(auth.userId);
    c.set('auth', auth);
    c.set('userHash', userHash);
    c.set('log', c.get('log').child({ user_hash: userHash }));
    await next();
  };
}

/** The verified identity; only valid after `requireUser`. */
export function currentUser(c: { get(key: 'auth'): UserAuth | undefined }): UserAuth {
  const auth = c.get('auth');
  if (auth === undefined) throw authRequired('missing_token');
  return auth;
}

/**
 * `user+recent_auth(n)` (API_CONTRACTS §3): the latest `amr[].timestamp` must be within `maxAgeSeconds`.
 */
export function requireRecentAuth(
  auth: UserAuth,
  maxAgeSeconds: number,
  now: Date = new Date(),
): void {
  const latest = Math.max(
    0,
    ...(auth.claims.amr ?? []).map((a) => (typeof a.timestamp === 'number' ? a.timestamp : 0)),
  );
  if (latest === 0 || now.getTime() / 1000 - latest > maxAgeSeconds) {
    throw new AppError('REAUTH_REQUIRED', { details: { max_age_seconds: maxAgeSeconds } });
  }
}
