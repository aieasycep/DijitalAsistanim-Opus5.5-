/**
 * `admin-api` (`/functions/v1/admin-api`; API_CONTRACTS §12, BACKOFFICE_PLAN §2.5). Server-to-server
 * only: browser `Origin` requests are refused. Every module route is mounted with
 * `adminRoute(permission)`: BFF key → admin JWT (`aal2`, dedicated admin identity) → the SQL gate
 * `admin_api.authorize(permission)` through the gateway header. Module routes (ADM-00…ADM-21) are
 * registered by the backoffice tasks; unknown paths answer `NOT_FOUND`.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { type AdminAuthOptions, requireAdmin } from '../_shared/auth/admin.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';

export interface AdminApiDeps {
  readonly auth: AdminAuthOptions;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

export interface AdminApi {
  readonly app: Hono<AppEnv>;
  /** Authentication and permission gate for one admin route. */
  adminRoute(permission: string): MiddlewareHandler<AppEnv>;
}

export function createAdminApi(deps: AdminApiDeps): AdminApi {
  const app = createApp({
    fn: 'admin-api',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  return { app, adminRoute: (permission) => requireAdmin(deps.auth, permission) };
}
