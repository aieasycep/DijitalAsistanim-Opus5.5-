import { admin, adminRoutes, type AdminRouteKey } from '@da/validation';
import { z } from 'zod';

/*
 * The admin-api routes the backoffice calls, keyed like the `@da/validation` registry
 * (`adminRoutes`, API_CONTRACTS §12.3). The registry keeps each route's response schema as a plain
 * `ZodType`; this map re-attaches the concrete schema per key so call sites are typed. A unit test
 * asserts every entry is the very schema object the registry holds, so the two can never drift.
 * Module tasks add their routes here.
 */
export const ADMIN_RESPONSES = {
  // ADM-00 · session, preferences, auth
  'POST /session/start': admin.SessionStartResponse,
  'POST /session/heartbeat': admin.SessionHeartbeatResponse,
  'POST /session/step-up': admin.StepUpResponse,
  'POST /session/logout': admin.SessionEndedResponse,
  'POST /session/logout-all': admin.SessionEndedResponse,
  'GET /me': admin.AdminMeResponse,
  'GET /preferences': admin.AdminPreferencesResponse,
  'PATCH /preferences': admin.AdminPreferencesResponse,
  'POST /auth/preflight': admin.AuthPreflightResponse,
  'POST /auth/attempt': admin.AuthAttemptResponse,
  'GET /auth/status': admin.AuthStatusResponse,
  'POST /auth/invite/redeem': admin.InviteRedeemResponse,
  'POST /auth/recovery-code/redeem': admin.RecoveryCodeRedeemResponse,
  'POST /me/recovery-codes': admin.RecoveryCodesResponse,
  // ADM-01 · dashboard
  'GET /dashboard/metrics': admin.DashboardMetricsResponse,
  'GET /dashboard/charts': admin.DashboardChartsResponse,
  // PII reveal (MaskedValue / RevealButton)
  'POST /users/:id/reveal': admin.RevealResponse,
  'POST /feedback/:id/reveal': admin.FeedbackRevealResponse,
  'POST /ai/feedback/:id/reveal': admin.AiFeedbackRevealResponse,
  // ADM-21 · command palette
  'GET /search': admin.AdminSearchResponse,
} as const satisfies Partial<Record<AdminRouteKey, z.ZodType>>;

export type TypedRouteKey = keyof typeof ADMIN_RESPONSES;
export type RouteEnvelope<K extends TypedRouteKey> = z.output<(typeof ADMIN_RESPONSES)[K]>;
export type RouteData<K extends TypedRouteKey> =
  RouteEnvelope<K> extends { data: infer D } ? D : never;
export type RouteMeta<K extends TypedRouteKey> =
  RouteEnvelope<K> extends { meta: infer M } ? M : never;

/** Mutation keys (anything but GET) among the typed routes. */
export type TypedMutationKey = {
  [K in TypedRouteKey]: K extends `GET ${string}` ? never : K;
}[TypedRouteKey];

/** The PII reveal routes MaskedValue may call (BACKOFFICE_PLAN §5.5). */
export const REVEAL_ROUTES = [
  'POST /users/:id/reveal',
  'POST /feedback/:id/reveal',
  'POST /ai/feedback/:id/reveal',
] as const satisfies readonly TypedMutationKey[];
export type RevealRouteKey = (typeof REVEAL_ROUTES)[number];

function bodyShape(key: AdminRouteKey): Record<string, z.ZodType> | null {
  const body = adminRoutes[key].request.body;
  if (body instanceof z.ZodObject) return body.shape;
  return null;
}

/** True when the route's body contract requires a `reason` (10–500 chars, stored in audit_logs). */
export function routeRequiresReason(key: AdminRouteKey): boolean {
  const reason = bodyShape(key)?.reason;
  return reason !== undefined && !reason.safeParse(undefined).success;
}

/** True when the route's body contract requires `confirm: true` (a sensitive mutation, §12.1). */
export function routeRequiresConfirm(key: AdminRouteKey): boolean {
  const confirm = bodyShape(key)?.confirm;
  return confirm !== undefined && !confirm.safeParse(undefined).success;
}

/** True when the route needs a fresh TOTP step-up (routes marked SU in BACKOFFICE_PLAN §12). */
export function routeRequiresStepUp(key: AdminRouteKey): boolean {
  return adminRoutes[key].access.step_up === true;
}

/** The permission a route requires, or `null` for own-account / BFF / aal1 routes. */
export function routePermission(key: AdminRouteKey): string | null {
  const required = adminRoutes[key].access.require;
  return required === 'own' || required === 'any_admin' || required === 'aal1' || required === 'bff'
    ? null
    : required;
}

/** Confirmation metadata a client dialog needs, derived from the registry on the server. */
export interface RouteConfirmation {
  readonly requiresReason: boolean;
  readonly requiresConfirm: boolean;
  readonly requiresStepUp: boolean;
}

export function routeConfirmation(key: AdminRouteKey): RouteConfirmation {
  return {
    requiresReason: routeRequiresReason(key),
    requiresConfirm: routeRequiresConfirm(key),
    requiresStepUp: routeRequiresStepUp(key),
  };
}
