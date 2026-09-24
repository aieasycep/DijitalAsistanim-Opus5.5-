/**
 * `public-api` (`/functions/v1/public-api`; API_CONTRACTS §13). Anonymous callers with rate limits;
 * CORS only for the marketing web origin (`PUBLIC_WEB_URL`, §2.15). A bearer token of a dedicated
 * admin identity is refused (R-08). The PUB-01…PUB-08 routes are registered by the public web tasks;
 * unknown paths answer `NOT_FOUND`.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { AppError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import { bearerToken, isAdminIdentity, type TokenVerifier } from '../_shared/auth/user.ts';

export interface PublicApiDeps {
  /** `PUBLIC_WEB_URL`; without it no origin receives CORS headers. */
  readonly webOrigin: string | undefined;
  readonly verifier: TokenVerifier | null;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

/** Refuses requests that carry a dedicated admin identity's token (R-08). */
export function rejectAdminBearer(verifier: TokenVerifier | null): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const jwt = bearerToken(c.req.header('Authorization'));
    if (jwt !== null && verifier !== null) {
      const claims = await verifier.verify(jwt).catch(() => null);
      if (claims !== null && isAdminIdentity(claims)) {
        throw new AppError('FORBIDDEN', { details: { reason: 'admin_identity' } });
      }
    }
    await next();
  };
}

export function createPublicApiApp(deps: PublicApiDeps): Hono<AppEnv> {
  const origins: string[] = [];
  if (deps.webOrigin !== undefined && deps.webOrigin.trim() !== '') {
    const origin = new URL(deps.webOrigin).origin;
    origins.push(origin);
  }
  const app = createApp({
    fn: 'public-api',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    cors: { origins },
  });
  app.use('*', rejectAdminBearer(deps.verifier));
  return app;
}
