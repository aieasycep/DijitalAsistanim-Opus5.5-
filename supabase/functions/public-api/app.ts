/**
 * `public-api` (`/functions/v1/public-api`; API_CONTRACTS §13). Anonymous callers with rate limits;
 * CORS only for the marketing web origin (`PUBLIC_WEB_URL`, §2.15: GET/POST, `content-type`,
 * `apikey`, `x-client-info`, no credentials). A bearer token of a dedicated admin identity is
 * refused (R-08). Routes:
 * - PUB-01 `POST /support`, PUB-08 `POST /support/inbound-email` (`routes/support.ts`);
 * - PUB-02 `POST /data-deletion/start`, PUB-03 `POST /data-deletion/verify`,
 *   PUB-07 `GET /data-deletion/:requestId/status` (`routes/data-deletion.ts`);
 * - PUB-04 `GET /referrals/:code` (`routes/referrals.ts`);
 * - PUB-05 `GET /plans`, PUB-06 `POST /web-events` (`routes/site.ts`).
 * Unknown paths answer `NOT_FOUND`.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { AppError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import { bearerToken, isAdminIdentity, type TokenVerifier } from '../_shared/auth/user.ts';
import type { PublicApiServices } from './deps.ts';
import { registerDeletionRoutes } from './routes/data-deletion.ts';
import { registerReferralRoutes } from './routes/referrals.ts';
import { registerSiteRoutes } from './routes/site.ts';
import { registerSupportRoutes } from './routes/support.ts';

export interface PublicApiDeps {
  /** `PUBLIC_WEB_URL`; without it no origin receives CORS headers. */
  readonly webOrigin: string | undefined;
  readonly verifier: TokenVerifier | null;
  readonly log: Logger;
  readonly sentry?: Sentry;
  readonly services: PublicApiServices;
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
  registerSupportRoutes(app, deps.services);
  registerDeletionRoutes(app, deps.services);
  registerReferralRoutes(app, deps.services);
  registerSiteRoutes(app, deps.services);
  return app;
}
