/**
 * Entitlement services for every Edge Function (IMPLEMENTATION_PLAN T-7.02):
 * - gates: `requireEntitlement(gate, userId, feature)`, `checkPlanLimit(gate, userId, key)`,
 *   `supabaseEntitlementGate(client)`, `usageDelta(state)`;
 * - `api` middleware: `routeEntitlementGate` (wired into `kit.chain`), `entitlementRequired`,
 *   `planLimitRequired`, and the `PRO_ROUTE_FEATURES` map;
 * - the `GET /me/entitlements` state builders (`../entitlements.ts`).
 */
export * from './gate.ts';
export * from './middleware.ts';
export * from '../entitlements.ts';
