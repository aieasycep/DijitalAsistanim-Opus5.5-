/**
 * @da/validation — zod 4 schemas for the API contracts (`api`, `admin-api`, `public-api`), the AI
 * structured outputs, approval payloads, webhooks, environment variables, the widget snapshot and
 * analytics events. Deno-safe: imports only zod, @da/domain (via the functions import map) and
 * relative `.ts` files.
 */
export * from './errors.ts';
export * from './enums.ts';
export * from './route.ts';
export * from './api/index.ts';
export * from './ai/index.ts';
export * from './env.ts';
export * from './widget-snapshot.ts';
export * from './analytics-events.ts';
export * from './webhooks/index.ts';
export { adminRoutes } from './admin/routes.ts';
export type { AdminRouteContract, AdminRouteKey, AdminRoutes } from './admin/routes.ts';
export { publicRoutes } from './public/routes.ts';
export type { PublicRouteKey, PublicRoutes } from './public/routes.ts';
/** `admin-api` schemas (ADM-00…ADM-21), namespaced because module names overlap with `api`. */
export * as admin from './admin/index.ts';
/** `public-api` schemas (PUB-01…PUB-08). */
export * as publicApi from './public/index.ts';
