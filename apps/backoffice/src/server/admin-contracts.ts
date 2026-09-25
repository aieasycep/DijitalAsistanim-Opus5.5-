import { admin, adminRoutes, type AdminRouteKey } from '@da/validation';
import { z } from 'zod';

/*
 * The admin-api routes the backoffice calls, keyed like the `@da/validation` registry
 * (`adminRoutes`, API_CONTRACTS §12.3). The registry keeps each route's response schema as a plain
 * `ZodType`; this map re-attaches the concrete schema per key so call sites are typed. It covers the
 * whole registry (`satisfies Record<AdminRouteKey, …>`), and a unit test asserts every entry is the
 * very schema object the registry holds, so the two can never drift.
 */
export const ADMIN_RESPONSES = {
  // ADM-00 · session, preferences, auth
  'POST /session/start': admin.SessionStartResponse,
  'POST /session/heartbeat': admin.SessionHeartbeatResponse,
  'GET /me': admin.AdminMeResponse,
  'GET /me/sessions': admin.AdminSessionsResponse,
  'POST /session/logout': admin.SessionEndedResponse,
  'POST /session/logout-all': admin.SessionEndedResponse,
  'GET /preferences': admin.AdminPreferencesResponse,
  'PATCH /preferences': admin.AdminPreferencesResponse,
  'POST /auth/preflight': admin.AuthPreflightResponse,
  'POST /auth/attempt': admin.AuthAttemptResponse,
  'GET /auth/status': admin.AuthStatusResponse,
  'POST /auth/invite/redeem': admin.InviteRedeemResponse,
  'POST /auth/recovery-code/redeem': admin.RecoveryCodeRedeemResponse,
  'POST /me/recovery-codes': admin.RecoveryCodesResponse,
  'POST /me/mfa-factors': admin.MfaFactorResponse,
  'DELETE /me/mfa-factors/:factorId': admin.MfaFactorResponse,
  'POST /session/step-up': admin.StepUpResponse,
  // ADM-01 · dashboard
  'GET /dashboard/metrics': admin.DashboardMetricsResponse,
  'GET /dashboard/charts': admin.DashboardChartsResponse,
  'GET /metrics/ops': admin.MetricsGroupsResponse,
  'GET /metrics/product': admin.MetricsGroupsResponse,
  'GET /security-events': admin.SecurityEventsResponse,
  // ADM-02 · users and user actions
  'GET /users': admin.UsersListResponse,
  'POST /users/lookup': admin.UserLookupResponse,
  'GET /users/:id': admin.UserOverviewResponse,
  'GET /users/:id/integrations': admin.UserIntegrationsResponse,
  'GET /users/:id/briefings': admin.UserBriefingsResponse,
  'GET /users/:id/usage': admin.UserUsageResponse,
  'GET /users/:id/subscription': admin.UserSubscriptionResponse,
  'GET /users/:id/referrals': admin.UserReferralsResponse,
  'GET /users/:id/support': admin.UserSupportResponse,
  'GET /users/:id/audit': admin.AuditListResponse,
  'GET /users/:id/devices': admin.UserDevicesResponse,
  'POST /users/:id/reveal': admin.RevealResponse,
  'POST /users/:id/force-sync': admin.UserForceSyncResponse,
  'POST /users/:id/disable': admin.UserStateResponse,
  'POST /users/:id/restore': admin.UserStateResponse,
  'POST /users/:id/entitlement-grants': admin.EntitlementGrantResponse,
  'POST /users/:id/entitlement-grants/:grantId/revoke': admin.EntitlementGrantResponse,
  'POST /users/:id/integrations/:accountId/disconnect': admin.AdminDisconnectResponse,
  'POST /users/:id/internal': admin.UserInternalResponse,
  // ADM-03 · support and Support Access
  'GET /support/tickets': admin.TicketsListResponse,
  'GET /support/tickets/:id': admin.TicketDetailResponse,
  'PATCH /support/tickets/:id': admin.TicketResponse,
  'POST /support/tickets/:id/notes': admin.TicketNoteResponse,
  'POST /support/tickets/:id/reply': admin.TicketReplyResponse,
  'POST /support-access/grants': admin.SupportAccessGrantResponse,
  'POST /support-access/grants/:id/revoke': admin.SupportAccessGrantResponse,
  'GET /support-access/grants/:id/content/:scope': admin.SupportContentResponse,
  // ADM-04 · integrations
  'GET /integrations': admin.IntegrationsListResponse,
  'GET /integrations/summary': admin.IntegrationsSummaryResponse,
  'GET /integrations/:accountId': admin.IntegrationDetailResponse,
  'POST /integrations/:accountId/force-sync': admin.IntegrationJobsResponse,
  'POST /integrations/:accountId/renew-watch': admin.IntegrationJobsResponse,
  // ADM-05 · sync and jobs
  'GET /jobs': admin.JobsListResponse,
  'GET /jobs/stats': admin.JobsStatsResponse,
  'POST /jobs/retry-bulk': admin.JobsBulkRetryResponse,
  'GET /jobs/:id': admin.JobDetailResponse,
  'GET /correlation/:id': admin.CorrelationTraceResponse,
  'POST /jobs/:id/retry': admin.JobMutationResponse,
  'POST /jobs/:id/cancel': admin.JobMutationResponse,
  // ADM-06 · briefings
  'GET /briefings/metrics': admin.BriefingsMetricsResponse,
  'GET /briefings': admin.BriefingsListResponse,
  'POST /briefings/:id/regenerate': admin.BriefingRegenerateResponse,
  // ADM-07 · notifications
  'GET /notifications/metrics': admin.NotificationsMetricsResponse,
  'GET /notifications': admin.NotificationsListResponse,
  'POST /notifications/test-push': admin.AdminTestPushResponse,
  'GET /notifications/test-push/preview': admin.AdminTestPushPreviewResponse,
  // ADM-08 · AI operations and model config
  'GET /ai/metrics': admin.AiMetricsResponse,
  'GET /ai/metrics/series': admin.AiMetricsSeriesResponse,
  'GET /ai/requests': admin.AiRequestsResponse,
  'GET /ai/models': admin.AiModelsResponse,
  'PATCH /ai/models/:profile/:feature': admin.ModelConfigResponse,
  'POST /ai/models/:profile/:feature/test': admin.ModelProbeResponse,
  'PATCH /ai/routing-profile': admin.RoutingProfileResponse,
  // ADM-09 · prompt management
  'GET /ai/prompts': admin.PromptsListResponse,
  'GET /ai/prompts/:key': admin.PromptVersionsResponse,
  'GET /ai/prompts/:key/diff': admin.PromptDiffResponse,
  'GET /ai/prompts/:key/versions/:v': admin.PromptVersionDetailResponse,
  'POST /ai/prompts/:key/versions': admin.PromptVersionResponse,
  'PATCH /ai/prompts/:key/versions/:v': admin.PromptVersionResponse,
  'POST /ai/prompts/:key/versions/:v/test': admin.PromptTestResponse,
  'POST /ai/prompts/:key/versions/:v/activate': admin.PromptVersionResponse,
  'POST /ai/prompts/:key/rollback': admin.PromptVersionResponse,
  'POST /ai/prompts/:key/versions/:v/archive': admin.PromptVersionResponse,
  // ADM-10 · AI feedback
  'GET /ai/feedback/aggregates': admin.AiFeedbackAggregatesResponse,
  'GET /ai/feedback': admin.AiFeedbackListResponse,
  'POST /ai/feedback/:id/reveal': admin.AiFeedbackRevealResponse,
  // ADM-11 · subscriptions and entitlement grants
  'GET /subscriptions/metrics': admin.SubscriptionsMetricsResponse,
  'GET /subscriptions': admin.SubscriptionsListResponse,
  'GET /subscriptions/events': admin.BillingEventsResponse,
  'GET /subscriptions/trial-stream': admin.TrialStreamResponse,
  'GET /subscriptions/events/:id': admin.BillingEventDetailResponse,
  'GET /entitlement-grants': admin.EntitlementGrantsListResponse,
  'POST /subscriptions/:userId/sync': admin.SubscriptionResyncResponse,
  // ADM-12 · referrals
  'GET /referrals/metrics': admin.ReferralsMetricsResponse,
  'GET /referrals': admin.ReferralsListResponse,
  'POST /referrals/:id/approve': admin.ReferralReviewResponse,
  'POST /referrals/:id/reject': admin.ReferralReviewResponse,
  // ADM-13 · feedback
  'GET /feedback': admin.FeedbackListResponse,
  'GET /feedback/summary': admin.FeedbackSummaryResponse,
  'PATCH /feedback/:id': admin.FeedbackResponse,
  'POST /feedback/:id/reveal': admin.FeedbackRevealResponse,
  // ADM-14 · feature flags
  'GET /flags': admin.FlagsListResponse,
  'GET /flags/:key': admin.FlagDetailResponse,
  'GET /flags/:key/evaluate': admin.FlagEvaluateResponse,
  'POST /flags': admin.FlagResponse,
  'PATCH /flags/:key': admin.FlagResponse,
  'POST /flags/:key/kill': admin.FlagResponse,
  'POST /flags/:key/archive': admin.FlagResponse,
  'POST /flags/:key/overrides': admin.FlagOverrideResponse,
  'DELETE /flags/:key/overrides/:userId': admin.FlagOverrideResponse,
  // ADM-15 · announcements
  'GET /announcements': admin.AnnouncementsListResponse,
  'POST /announcements/audience-estimate': admin.AudienceEstimateResponse,
  'GET /announcements/:id': admin.AnnouncementDetailResponse,
  'POST /announcements': admin.AnnouncementResponse,
  'PATCH /announcements/:id': admin.AnnouncementResponse,
  'POST /announcements/:id/preview': admin.AnnouncementPreviewResponse,
  'POST /announcements/:id/schedule': admin.AnnouncementResponse,
  'POST /announcements/:id/cancel': admin.AnnouncementResponse,
  // ADM-16 · data requests
  'GET /data-requests': admin.DataRequestsListResponse,
  'POST /data-requests/export/:id/regenerate': admin.ExportRegenerateResponse,
  'GET /data-requests/:kind/:id': admin.DataRequestDetailResponse,
  'POST /data-requests/:kind/:id/retry': admin.DataRequestRetryResponse,
  // ADM-17 · audit logs (read-only)
  'GET /audit': admin.AuditListResponse,
  'GET /audit/verify-chain': admin.AuditVerifyResponse,
  'GET /audit/:id': admin.AuditDetailResponse,
  // ADM-18 · system health and observability
  'GET /health/summary': admin.HealthSummaryResponse,
  'GET /health/history': admin.HealthHistoryResponse,
  'POST /health/run': admin.HealthRunResponse,
  'GET /health/app-versions': admin.AppVersionsResponse,
  'GET /health/cron': admin.CronHealthResponse,
  // ADM-19 · admin users
  'GET /admins': admin.AdminUsersResponse,
  'POST /admins/invite': admin.AdminUserResponse,
  'PATCH /admins/:id': admin.AdminUserResponse,
  'POST /admins/:id/disable': admin.AdminUserResponse,
  'POST /admins/:id/enable': admin.AdminUserResponse,
  'POST /admins/:id/revoke-sessions': admin.AdminSessionsRevokedResponse,
  'POST /admins/:id/resend-invite': admin.AdminUserResponse,
  'POST /admins/:id/reset-mfa': admin.AdminUserResponse,
  'POST /admins/:id/unlock': admin.AdminUserResponse,
  // ADM-20 · settings
  'GET /settings': admin.SettingsResponse,
  'PATCH /settings/plan-limits': admin.SettingChangedResponse,
  'PATCH /settings/config/:key': admin.SettingChangedResponse,
  // ADM-21 · command palette
  'GET /search': admin.AdminSearchResponse,
} as const satisfies Record<AdminRouteKey, z.ZodType>;

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

/**
 * The module mutations the generic `mutateAction` may run (BACKOFFICE_PLAN §6, T-10.05…T-10.14).
 * Session, sign-in, preference, reveal and lookup routes have dedicated actions and are not here, so
 * a crafted call can never reach them through the module path. Every entry still goes through the
 * route's own zod contract, the Origin check and admin-api's permission guard.
 */
export const MODULE_MUTATION_ROUTES = [
  // Users
  'POST /users/:id/force-sync',
  'POST /users/:id/disable',
  'POST /users/:id/restore',
  'POST /users/:id/internal',
  'POST /users/:id/entitlement-grants',
  'POST /users/:id/entitlement-grants/:grantId/revoke',
  'POST /users/:id/integrations/:accountId/disconnect',
  // Support and Support Access
  'PATCH /support/tickets/:id',
  'POST /support/tickets/:id/notes',
  'POST /support/tickets/:id/reply',
  'POST /support-access/grants',
  'POST /support-access/grants/:id/revoke',
  // Integrations, jobs
  'POST /integrations/:accountId/force-sync',
  'POST /integrations/:accountId/renew-watch',
  'POST /jobs/:id/retry',
  'POST /jobs/:id/cancel',
  'POST /jobs/retry-bulk',
  // Briefings, notifications
  'POST /briefings/:id/regenerate',
  'POST /notifications/test-push',
  // AI
  'PATCH /ai/models/:profile/:feature',
  'POST /ai/models/:profile/:feature/test',
  'PATCH /ai/routing-profile',
  'POST /ai/prompts/:key/versions',
  'PATCH /ai/prompts/:key/versions/:v',
  'POST /ai/prompts/:key/versions/:v/test',
  'POST /ai/prompts/:key/versions/:v/activate',
  'POST /ai/prompts/:key/rollback',
  'POST /ai/prompts/:key/versions/:v/archive',
  // Business
  'POST /subscriptions/:userId/sync',
  'POST /referrals/:id/approve',
  'POST /referrals/:id/reject',
  // Product
  'PATCH /feedback/:id',
  'POST /flags',
  'PATCH /flags/:key',
  'POST /flags/:key/kill',
  'POST /flags/:key/archive',
  'POST /flags/:key/overrides',
  'DELETE /flags/:key/overrides/:userId',
  'POST /announcements',
  'PATCH /announcements/:id',
  'POST /announcements/audience-estimate',
  'POST /announcements/:id/schedule',
  'POST /announcements/:id/cancel',
  // Privacy
  'POST /data-requests/:kind/:id/retry',
  'POST /data-requests/export/:id/regenerate',
  // System
  'POST /health/run',
  'POST /admins/invite',
  'PATCH /admins/:id',
  'POST /admins/:id/disable',
  'POST /admins/:id/enable',
  'POST /admins/:id/revoke-sessions',
  'POST /admins/:id/resend-invite',
  'POST /admins/:id/reset-mfa',
  'POST /admins/:id/unlock',
  'PATCH /settings/plan-limits',
  'PATCH /settings/config/:key',
  'POST /session/logout-all',
  'POST /me/recovery-codes',
  'DELETE /me/mfa-factors/:factorId',
] as const satisfies readonly TypedMutationKey[];
export type ModuleMutationKey = (typeof MODULE_MUTATION_ROUTES)[number];

export function isModuleMutation(value: unknown): value is ModuleMutationKey {
  return typeof value === 'string' && (MODULE_MUTATION_ROUTES as readonly string[]).includes(value);
}

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

/**
 * The audit log's action filter (§6.20): the BACKOFFICE_PLAN §10 catalogue, sorted. Every action a
 * route or SQL function emits is a catalogue name (tests in validation, admin-api and pgTAP).
 */
export function auditActions(): string[] {
  return [...admin.AUDIT_ACTIONS].sort();
}

export type RouteConfirmations = Readonly<Record<ModuleMutationKey, RouteConfirmation>>;

/**
 * The confirmation metadata of every module mutation, computed on the server once per request and
 * handed to the client dialogs (`RouteMetaProvider`), so the registry never ships to the browser.
 */
export function moduleConfirmations(): RouteConfirmations {
  return Object.fromEntries(
    MODULE_MUTATION_ROUTES.map((key) => [key, routeConfirmation(key)]),
  ) as RouteConfirmations;
}
