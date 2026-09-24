/**
 * Backoffice RBAC (M§47; BACKOFFICE_PLAN §4; plan §10; R-09, R-20).
 *
 * `PERMISSIONS` is the BACKOFFICE_PLAN §4.1 catalogue verbatim and `ROLE_PERMISSIONS` is the
 * BACKOFFICE_PLAN §4.2 role × permission matrix. This file is the source of truth; the SQL table
 * `private.admin_role_permissions` is seeded from it (migration 0012, `renderAdminRolePermissionSeed`)
 * and a parity test compares the two. Enforcement happens server-side in `admin-api` and again in
 * the `admin_api` SQL functions (`private.require_admin(permission)`); UI gating is cosmetic.
 */
import type { AdminRole, AdminStatus, GrantSource } from './enums.ts';
import { ADMIN_ROLE_VALUES } from './enums.ts';
import { ADMIN_GRANT_DURATION_DAYS } from './entitlements/effective.ts';

export const PERMISSIONS = [
  'dashboard.read',
  'metrics.ops.read',
  'metrics.ai.read',
  'metrics.revenue.read',
  'metrics.product.read',
  'users.read',
  'users.pii.reveal',
  'users.force_sync',
  'users.disable',
  'users.mark_internal',
  'integrations.read',
  'integrations.disconnect',
  'integrations.renew_watch',
  'jobs.read',
  'jobs.retry',
  'jobs.cancel',
  'briefings.read',
  'briefings.regenerate',
  'notifications.read',
  'push.test',
  'ai.read',
  'ai.models.write',
  'prompts.read',
  'prompts.write',
  'prompts.activate',
  'ai_feedback.read',
  'ai_feedback.reveal',
  'subscriptions.read',
  'billing_events.read',
  'subscriptions.resync',
  'entitlements.grant',
  'entitlements.grant_limited',
  'entitlements.revoke',
  'referrals.read',
  'referrals.review',
  'support.read',
  'support.write',
  'support.access',
  'feedback.read',
  'feedback.write',
  'flags.read',
  'flags.write',
  'flags.write_ai',
  'announcements.read',
  'announcements.write',
  'data_requests.read',
  'data_requests.manage',
  'audit.read',
  'health.read',
  'health.run',
  'admins.read',
  'admins.manage',
  'settings.system.write',
  'search.global',
] as const;

export type AdminPermission = (typeof PERMISSIONS)[number];

/**
 * `read`: view data (aggregates or masked rows). `reveal`: unmask content. `mutation`: changes
 * state or triggers a side effect. `analyst` and `readonly` hold `read` permissions only.
 */
export type AdminPermissionKind = 'read' | 'reveal' | 'mutation';

const REVEAL_PERMISSIONS: ReadonlySet<AdminPermission> = new Set<AdminPermission>([
  'users.pii.reveal',
  'ai_feedback.reveal',
]);

export function permissionKind(permission: AdminPermission): AdminPermissionKind {
  if (permission.endsWith('.read') || permission === 'search.global') return 'read';
  if (REVEAL_PERMISSIONS.has(permission)) return 'reveal';
  return 'mutation';
}

export function isAdminPermission(value: string): value is AdminPermission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

const READS_OPERATIONS: readonly AdminPermission[] = [
  'dashboard.read',
  'metrics.ops.read',
  'metrics.ai.read',
  'metrics.product.read',
  'users.read',
  'integrations.read',
  'jobs.read',
  'briefings.read',
  'notifications.read',
  'ai.read',
  'prompts.read',
  'subscriptions.read',
  'referrals.read',
  'support.read',
  'feedback.read',
  'flags.read',
  'announcements.read',
  'data_requests.read',
  'audit.read',
  'health.read',
  'admins.read',
  'search.global',
];

/** BACKOFFICE_PLAN §4.2, one list per role, in catalogue order. */
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  super_admin: PERMISSIONS,
  operations: sortByCatalogue([
    ...READS_OPERATIONS,
    'users.force_sync',
    'users.disable',
    'users.mark_internal',
    'integrations.disconnect',
    'integrations.renew_watch',
    'jobs.retry',
    'jobs.cancel',
    'briefings.regenerate',
    'push.test',
    'feedback.write',
    'flags.write',
    'flags.write_ai',
    'announcements.write',
    'data_requests.manage',
    'health.run',
  ]),
  support: sortByCatalogue([
    'dashboard.read',
    'users.read',
    'users.pii.reveal',
    'users.force_sync',
    'integrations.read',
    'jobs.read',
    'briefings.read',
    'notifications.read',
    'subscriptions.read',
    'subscriptions.resync',
    'entitlements.grant_limited',
    'referrals.read',
    'support.read',
    'support.write',
    'support.access',
    'feedback.read',
    'feedback.write',
    'announcements.read',
    'data_requests.read',
    'data_requests.manage',
    'audit.read',
    'health.read',
    'search.global',
  ]),
  finance: sortByCatalogue([
    'dashboard.read',
    'metrics.revenue.read',
    'metrics.product.read',
    'users.read',
    'subscriptions.read',
    'billing_events.read',
    'subscriptions.resync',
    'entitlements.grant',
    'entitlements.revoke',
    'referrals.read',
    'referrals.review',
    'health.read',
    'search.global',
  ]),
  ai_ops: sortByCatalogue([
    'dashboard.read',
    'metrics.ops.read',
    'metrics.ai.read',
    'jobs.read',
    'briefings.read',
    'ai.read',
    'ai.models.write',
    'prompts.read',
    'prompts.write',
    'prompts.activate',
    'ai_feedback.read',
    'ai_feedback.reveal',
    'feedback.read',
    'flags.read',
    'flags.write_ai',
    'health.read',
    'search.global',
  ]),
  analyst: sortByCatalogue([
    'dashboard.read',
    'metrics.ops.read',
    'metrics.ai.read',
    'metrics.revenue.read',
    'metrics.product.read',
  ]),
  readonly: sortByCatalogue([
    'dashboard.read',
    'metrics.ops.read',
    'metrics.ai.read',
    'metrics.product.read',
    'users.read',
    'integrations.read',
    'jobs.read',
    'briefings.read',
    'notifications.read',
    'ai.read',
    'prompts.read',
    'ai_feedback.read',
    'subscriptions.read',
    'billing_events.read',
    'referrals.read',
    'support.read',
    'feedback.read',
    'flags.read',
    'announcements.read',
    'data_requests.read',
    'audit.read',
    'health.read',
    'admins.read',
    'search.global',
  ]),
};

function sortByCatalogue(list: readonly AdminPermission[]): readonly AdminPermission[] {
  const set = new Set(list);
  return PERMISSIONS.filter((permission) => set.has(permission));
}

const ROLE_PERMISSION_SETS: ReadonlyMap<AdminRole, ReadonlySet<AdminPermission>> = new Map(
  ADMIN_ROLE_VALUES.map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
);

/** True when the role holds the permission. Unknown strings are never granted. */
export function can(role: AdminRole, permission: string): boolean {
  if (!isAdminPermission(permission)) return false;
  return ROLE_PERMISSION_SETS.get(role)?.has(permission) ?? false;
}

export function permissionsFor(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

/** Every `(role, permission)` pair, role order per the enum, permission order per the catalogue. */
export function rolePermissionPairs(): { role: AdminRole; permission: AdminPermission }[] {
  return ADMIN_ROLE_VALUES.flatMap((role) =>
    ROLE_PERMISSIONS[role].map((permission) => ({ role, permission })),
  );
}

/**
 * The `private.admin_role_permissions` seed statement for migration 0012. The parity test parses
 * the migration's `insert into private.admin_role_permissions` statement with the same tuple form.
 */
export function renderAdminRolePermissionSeed(): string {
  const rows = rolePermissionPairs().map(
    ({ role, permission }) => `  ('${role}', '${permission}')`,
  );
  return `insert into private.admin_role_permissions (role, permission) values\n${rows.join(',\n')};\n`;
}

// ---------------------------------------------------------------------------------------------
// Argument-dependent rules (BACKOFFICE_PLAN §4.3; DATABASE_AND_RLS_PLAN §4.9)

/** Durations `entitlements.grant_limited` may use (source `support` only). */
export const LIMITED_GRANT_DAYS = [1, 7] as const;

/**
 * `entitlement_grant`: `entitlements.grant` allows 1/7/14/30 days with source admin, support or
 * compensation; `entitlements.grant_limited` alone allows only 1 or 7 days with source `support`.
 */
export function canGrantEntitlement(
  role: AdminRole,
  grant: { source: GrantSource; days: number },
): boolean {
  const adminSource =
    grant.source === 'admin' || grant.source === 'support' || grant.source === 'compensation';
  if (!adminSource || !(ADMIN_GRANT_DURATION_DAYS as readonly number[]).includes(grant.days)) {
    return false;
  }
  if (can(role, 'entitlements.grant')) return true;
  return (
    can(role, 'entitlements.grant_limited') &&
    grant.source === 'support' &&
    (LIMITED_GRANT_DAYS as readonly number[]).includes(grant.days)
  );
}

/** Flag keys that `flags.write_ai` may change (`ai.%` or `voice.%`). */
export function isAiFlagKey(key: string): boolean {
  return key.startsWith('ai.') || key.startsWith('voice.');
}

/** Flag mutations need `flags.write`, or `flags.write_ai` for `ai.*` / `voice.*` keys. */
export function canWriteFlag(role: AdminRole, key: string): boolean {
  if (can(role, 'flags.write')) return true;
  return can(role, 'flags.write_ai') && isAiFlagKey(key);
}

/** Support Access (R-09) is available only to roles holding `support.access`. */
export function canRequestSupportAccess(role: AdminRole): boolean {
  return can(role, 'support.access');
}

// ---------------------------------------------------------------------------------------------
// Last super_admin and self-protection (BACKOFFICE_PLAN §4.4)

/**
 * Enforced in the database, not here: trigger `private.admin_users_guard()` (BEFORE UPDATE OR
 * DELETE on `admin_users`) and the self-protection checks in `admin_update_role`, `admin_disable`,
 * `admin_enable` and `admin_mfa_reset`. `checkAdminChange` describes the same rules so the
 * backoffice can disable the control and explain why before the request is sent.
 */
export const ADMIN_GUARD_RULES = {
  admins_never_deleted: 'Admin rows are never deleted; admins are disabled instead.',
  last_super_admin: 'The last active super_admin cannot be demoted or have its status changed.',
  self_change_forbidden:
    'An admin cannot change their own role, status or MFA from the admin screens.',
} as const;

export type AdminGuardViolation = keyof typeof ADMIN_GUARD_RULES;

export interface AdminRow {
  id: string;
  role: AdminRole;
  status: AdminStatus;
}

export type AdminChange =
  | { kind: 'update'; role?: AdminRole; status?: AdminStatus }
  | { kind: 'mfa_reset' }
  | { kind: 'delete' };

export function checkAdminChange(input: {
  admins: readonly AdminRow[];
  targetId: string;
  callerId: string;
  change: AdminChange;
}): AdminGuardViolation | null {
  const { admins, targetId, callerId, change } = input;
  if (change.kind === 'delete') return 'admins_never_deleted';
  if (targetId === callerId) return 'self_change_forbidden';
  if (change.kind === 'mfa_reset') return null;
  const target = admins.find((admin) => admin.id === targetId);
  if (target?.role !== 'super_admin' || target.status !== 'active') return null;
  const roleChanges = change.role !== undefined && change.role !== target.role;
  const statusChanges = change.status !== undefined && change.status !== target.status;
  if (!roleChanges && !statusChanges) return null;
  const otherActiveSuperAdmins = admins.filter(
    (admin) => admin.id !== targetId && admin.role === 'super_admin' && admin.status === 'active',
  ).length;
  return otherActiveSuperAdmins === 0 ? 'last_super_admin' : null;
}
