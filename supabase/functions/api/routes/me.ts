/** API-BOOT-01 `GET /me/bootstrap`, API-BOOT-02 `GET /me/entitlements`. */
import { routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { sendCacheable } from '../../_shared/http/respond.ts';
import { mountRoute, validateRequest } from '../../_shared/http/validate.ts';
import { isDemoEnabled } from '../../_shared/providers/demo/guard.ts';
import { buildBootstrap } from '../../_shared/services/bootstrap.ts';
import { buildEntitlementState, buildUsageSummary } from '../../_shared/services/entitlements.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerMeRoutes: RouteRegistrar = (app, kit) => {
  const bootstrap = routes['GET /me/bootstrap'];
  mountRoute(
    app,
    bootstrap,
    // The account-state gate is reported in the body (`account_state`, `config.upgrade_required`).
    ...kit.chain({ gate: false, rateLimit: 'api_default' }),
    validateRequest(bootstrap),
    async (c) => {
      const auth = currentUser(c);
      const repos = kit.deps.repos(auth);
      const data = await buildBootstrap(repos.bootstrap, {
        userId: auth.userId,
        claims: auth.claims,
        client: c.get('client'),
        installationId: c.get('installationId'),
        capabilities: kit.deps.capabilities,
        demoMode: isDemoEnabled(kit.deps.raw),
        now: kit.now(),
      });
      const { server_now: _serverNow, ...stable } = data;
      return sendCacheable(c, data, stable);
    },
  );

  const entitlements = routes['GET /me/entitlements'];
  mountRoute(
    app,
    entitlements,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    validateRequest(entitlements),
    async (c) => {
      const auth = currentUser(c);
      const repos = kit.deps.repos(auth);
      const now = kit.now();
      const [effective, subscription, grants, usage, preferences] = await Promise.all([
        repos.entitlements.effective(auth.userId),
        repos.entitlements.subscription(auth.userId),
        repos.entitlements.grants(auth.userId),
        repos.entitlements.usage(),
        repos.bootstrap.preferences(auth.userId),
      ]);
      const plan = effective.is_active ? 'pro' : 'free';
      const data = {
        entitlement: buildEntitlementState(effective, subscription, grants, now),
        usage: buildUsageSummary(usage, plan, preferences?.timezone ?? 'Europe/Istanbul', now),
      };
      return sendCacheable(c, data, data);
    },
  );
};
