/**
 * The audit action catalogue (BACKOFFICE_PLAN §10; SQL `private.audit_action_catalogue`, kept equal
 * by the admin-api catalogue test). Every admin action stored in `audit_logs.action` is one of these
 * names: `admin_api` functions and admin-api handlers emit them, and `private.audit_log_append`
 * stores the catalogue name for the older emitter spellings. Rows written by the app, the worker
 * or the system outside these areas use the `user.*`, `system.*`, `security.*`, `approval.*` and
 * `privacy.*` namespaces (`isKnownAuditAction`).
 */

export const AUDIT_ACTION_AREAS = [
  'admin_auth',
  'admin_mgmt',
  'users',
  'operations',
  'ai',
  'business',
  'support_product',
  'privacy_system',
] as const;
export type AuditActionArea = (typeof AUDIT_ACTION_AREAS)[number];

const CATALOGUE = {
  admin_auth: [
    'admin.bootstrap',
    'admin.login',
    'admin.login_failed',
    'admin.login_denied',
    'admin.locked',
    'admin.unlocked',
    'admin.mfa_enrolled',
    'admin.mfa_challenge_failed',
    'admin.mfa_recovery_used',
    'admin.mfa_factor_added',
    'admin.mfa_factor_removed',
    'admin.recovery_codes_regenerated',
    'admin.logout',
    'admin.logout_all',
    'admin.session_expired',
    'admin.permission_denied',
    'admin.rate_limited',
    'admin.step_up',
    'admin.invite_redeemed',
  ],
  admin_mgmt: [
    'admin.invited',
    'admin.invite_resent',
    'admin.invite_accepted',
    'admin.role_changed',
    'admin.disabled',
    'admin.enabled',
    'admin.mfa_reset',
    'admin.sessions_revoked',
  ],
  users: [
    'user.lookup_by_email',
    'user.pii_revealed',
    'user.force_sync',
    'user.disabled',
    'user.restored',
    'user.marked_internal',
    'user.unmarked_internal',
  ],
  operations: [
    'integration.disconnected',
    'integration.watch_renew_requested',
    'job.retried',
    'job.bulk_retried',
    'job.cancelled',
    'briefing.regenerated',
    'push.test_sent',
    'health.run_requested',
  ],
  ai: [
    'ai_model_config.updated',
    'ai_model_config.tested',
    'ai_routing_profile.changed',
    'ai_model_price.updated',
    'ai_calibration.activated',
    'prompt.draft_created',
    'prompt.draft_updated',
    'prompt.tested',
    'prompt.activated',
    'prompt.rolled_back',
    'prompt.archived',
    'ai_feedback.comment_revealed',
  ],
  business: [
    'subscription.resync_requested',
    'entitlement.granted',
    'entitlement.revoked',
    'referral.approved',
    'referral.rejected',
    'referral.rewarded',
  ],
  support_product: [
    'ticket.updated',
    'ticket.assigned',
    'ticket.note_added',
    'ticket.reply_sent',
    'ticket.reply_failed',
    'support_access.granted',
    'support_access.revoked',
    'support_access.expired',
    'support_access.content_viewed',
    'feedback.updated',
    'feedback.revealed',
    'flag.created',
    'flag.updated',
    'flag.kill_switch_on',
    'flag.kill_switch_off',
    'flag.override_added',
    'flag.override_removed',
    'flag.archived',
    'announcement.created',
    'announcement.updated',
    'announcement.scheduled',
    'announcement.cancelled',
  ],
  privacy_system: [
    'data_request.retried',
    'data_request.export_regenerated',
    'data_request.cancelled',
    'settings.system_updated',
    'plan_limits.updated',
    'audit.verified',
  ],
} as const satisfies Record<AuditActionArea, readonly string[]>;

export type AuditAction = (typeof CATALOGUE)[AuditActionArea][number];

/** `{action, area}` in the §10 order. */
export const AUDIT_ACTION_CATALOGUE: readonly { action: AuditAction; area: AuditActionArea }[] =
  AUDIT_ACTION_AREAS.flatMap((area) =>
    (CATALOGUE[area] as readonly AuditAction[]).map((action) => ({ action, area })),
  );

export const AUDIT_ACTIONS: readonly AuditAction[] = AUDIT_ACTION_CATALOGUE.map((a) => a.action);

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
const APP_NAMESPACE = /^(user|system|security|approval|privacy)\.[a-z_]+(\.[a-z_]+){0,2}$/;

export function isCatalogueAction(action: string): action is AuditAction {
  return ACTION_SET.has(action);
}

/** A catalogue action or an app / worker / system namespace action. */
export function isKnownAuditAction(action: string): boolean {
  return ACTION_SET.has(action) || APP_NAMESPACE.test(action);
}
