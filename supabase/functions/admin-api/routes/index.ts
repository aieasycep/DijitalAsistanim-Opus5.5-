/**
 * The admin-api route table: exactly one spec per `@da/validation` admin registry route (the type
 * below fails to compile when a registry key is missing, UT-RBAC-03 / EF-ADM-01).
 */
import { type AdminRouteKey, adminRoutes } from '@da/validation';
import type { RouteSpec } from '../lib/route.ts';
import { aiRoutes } from './ai.ts';
import { authRoutes } from './auth.ts';
import { briefingsRoutes } from './briefings.ts';
import { dashboardRoutes } from './dashboard.ts';
import { integrationsRoutes } from './integrations.ts';
import { jobsRoutes } from './jobs.ts';
import { meRoutes } from './me.ts';
import { privacyOpsRoutes } from './privacy-ops.ts';
import { productRoutes } from './product.ts';
import { promptsRoutes } from './prompts.ts';
import { sessionRoutes } from './session.ts';
import { subscriptionsRoutes } from './subscriptions.ts';
import { supportRoutes } from './support.ts';
import { systemRoutes } from './system.ts';
import { usersRoutes } from './users.ts';

export const ADMIN_ROUTE_SPECS: Readonly<Record<AdminRouteKey, RouteSpec>> = {
  ...authRoutes,
  ...sessionRoutes,
  ...meRoutes,
  ...dashboardRoutes,
  ...usersRoutes,
  ...supportRoutes,
  ...integrationsRoutes,
  ...jobsRoutes,
  ...briefingsRoutes,
  ...aiRoutes,
  ...promptsRoutes,
  ...subscriptionsRoutes,
  ...productRoutes,
  ...privacyOpsRoutes,
  ...systemRoutes,
};

/**
 * Registry keys in mount order: fewer path parameters first, so literal paths (`/jobs/stats`,
 * `/audit/verify-chain`, `/users/lookup`) win over their `/:id` siblings; the sort is stable.
 */
export function orderedRouteKeys(): AdminRouteKey[] {
  const params = (key: AdminRouteKey) => (adminRoutes[key].path.match(/\/:/g) ?? []).length;
  return (Object.keys(adminRoutes) as AdminRouteKey[])
    .map((key, index) => ({ key, index }))
    .sort((a, b) => params(a.key) - params(b.key) || a.index - b.index)
    .map((entry) => entry.key);
}
