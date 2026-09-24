/**
 * The `api` Hono app (`/functions/v1/api`; API_CONTRACTS §8, IMPLEMENTATION_PLAN T-3.11).
 *
 * Middleware order per route: correlation id and request log (app) → user auth (`getClaims`, admin
 * identities rejected) → account-state and client-version gate → rate limit → Pro gate of the route
 * (`PRO_ROUTE_FEATURES`, 402 `ENTITLEMENT_REQUIRED`) → JSON body parse → zod
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
import { routeEntitlementGate } from '../_shared/services/entitlements/middleware.ts';
import type { ApiDeps, RouteKit, RouteRegistrar } from './deps.ts';
import { registerAnalyticsRoutes } from './routes/analytics.ts';
import { registerAppleRoutes } from './routes/auth-apple.ts';
import { registerDeviceRoutes } from './routes/devices.ts';
import { integrationRoutes } from './routes/integrations.ts';
import { mailOriginalRoutes } from './routes/mail-original.ts';
import { registerMeRoutes } from './routes/me.ts';
import { registerSupportRoutes } from './routes/support.ts';
import { registerApprovalRoutes } from './routes/approvals.ts';
import { registerReminderRoutes } from './routes/reminders.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerWidgetRoutes } from './routes/widgets.ts';
import { registerBusinessRoutes } from './routes/business.ts';
import { registerReferralRoutes } from './routes/referrals.ts';
import { registerThreadSummaryRoutes } from './routes/mail-summary.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerBriefingRoutes } from './routes/briefings.ts';
import { registerMailRoutes } from './routes/mail.ts';
import { registerFollowupRoutes } from './routes/followups.ts';
import { registerMeetingRoutes } from './routes/meetings.ts';
import { registerAssistantRoutes } from './routes/assistant.ts';
import { registerCaptureRoutes } from './routes/captures.ts';
import { registerPlanRoutes } from './routes/plan.ts';
import { registerOnboardingRoutes } from './routes/onboarding.ts';
import { registerBriefingAudioRoutes } from './routes/briefing-audio.ts';

/** `extra` registrars mount after the built-in routes (tests use it for the Pro-gate matrix). */
export function createApiApp(deps: ApiDeps, extra: readonly RouteRegistrar[] = []): Hono<AppEnv> {
  const app = createApp({
    fn: 'api',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  const now = deps.now ?? (() => new Date());
  const auth = requireUser(deps.verifier, { userHash: (userId) => logHash(deps.env, userId) });
  const gate = requireActiveAccount({ accounts: deps.accounts, settings: deps.settings });
  // Pro gate of every route listed in PRO_ROUTE_FEATURES (API_CONTRACTS §4.1; T-7.02).
  const proGate = routeEntitlementGate((auth) => deps.business.gate(auth));
  const kit: RouteKit = {
    deps,
    now,
    chain: ({ gate: gated, rateLimit: cls }) => {
      const list: MiddlewareHandler<AppEnv>[] = [auth];
      if (gated) list.push(gate);
      list.push(
        rateLimit({ store: deps.rateLimits, scope: 'api', now: () => now().getTime() }, cls),
      );
      list.push(proGate);
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
  registerBusinessRoutes(app, kit);
  registerReferralRoutes(app, kit);
  for (const register of extra) register(app, kit);
  if (deps.integrations !== undefined) {
    integrationRoutes(deps.integrations)(app, kit);
    mailOriginalRoutes(deps.integrations)(app, kit);
  }
  registerThreadSummaryRoutes(app, kit);
  registerSearchRoutes(app, kit);
  registerBriefingRoutes(app, kit);
  // AI pipeline part 2 (T-5.09…T-5.15).
  registerMailRoutes(app, kit);
  registerFollowupRoutes(app, kit);
  registerMeetingRoutes(app, kit);
  registerAssistantRoutes(app, kit);
  registerCaptureRoutes(app, kit);
  registerPlanRoutes(app, kit);
  registerOnboardingRoutes(app, kit);
  registerBriefingAudioRoutes(app, kit);
  return app;
}
