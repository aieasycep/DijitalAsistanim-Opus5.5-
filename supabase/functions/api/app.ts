/**
 * The `api` Hono app (`/functions/v1/api`; API_CONTRACTS §8, IMPLEMENTATION_PLAN T-3.11).
 *
 * Middleware order per route: correlation id and request log (app) → user auth (`getClaims`, admin
 * identities rejected) → account-state and client-version gate → rate limit → JSON body parse → zod
 * validation from the `@da/validation` route registry → handler (HTTP idempotency for `[IK]` routes)
 * → `{data, meta}` envelope; errors → the standard error envelope. Browser `Origin` requests are
 * refused (native client only).
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { createApp } from '../_shared/http/app.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import { requireUser } from '../_shared/auth/user.ts';
import { logHash } from '../_shared/crypto/hash.ts';
import { rateLimit } from '../_shared/ratelimit.ts';
import { requireActiveAccount } from '../_shared/services/account-state.ts';
import type { ApiDeps, RouteKit } from './deps.ts';
import { registerAnalyticsRoutes } from './routes/analytics.ts';
import { registerAppleRoutes } from './routes/auth-apple.ts';
import { registerDeviceRoutes } from './routes/devices.ts';
import { registerMeRoutes } from './routes/me.ts';
import { registerSupportRoutes } from './routes/support.ts';
import { registerApprovalRoutes } from './routes/approvals.ts';
import { registerReminderRoutes } from './routes/reminders.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerWidgetRoutes } from './routes/widgets.ts';

export function createApiApp(deps: ApiDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'api',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  const now = deps.now ?? (() => new Date());
  const auth = requireUser(deps.verifier, { userHash: (userId) => logHash(deps.env, userId) });
  const gate = requireActiveAccount({ accounts: deps.accounts, settings: deps.settings });
  const kit: RouteKit = {
    deps,
    now,
    chain: ({ gate: gated, rateLimit: cls }) => {
      const list: MiddlewareHandler<AppEnv>[] = [auth];
      if (gated) list.push(gate);
      list.push(
        rateLimit({ store: deps.rateLimits, scope: 'api', now: () => now().getTime() }, cls),
      );
      return list;
    },
  };
  registerDeviceRoutes(app, kit);
  registerAppleRoutes(app, kit);
  registerMeRoutes(app, kit);
  registerAnalyticsRoutes(app, kit);
  registerSupportRoutes(app, kit);
  registerApprovalRoutes(app, kit);
  registerReminderRoutes(app, kit);
  registerNotificationRoutes(app, kit);
  registerWidgetRoutes(app, kit);
  return app;
}
