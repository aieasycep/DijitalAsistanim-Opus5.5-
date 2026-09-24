/**
 * Route guard and step-up (BACKOFFICE_PLAN §2.5 steps 6–7, §4.3; API_CONTRACTS §12.2).
 *
 * The registry access rule of each route (`require` + `also` + `or`) is checked against the
 * context permissions and fails fast; the same permission is re-checked in SQL by the function the
 * route calls. A denial writes its `denied` audit row through `admin_api.audit_denied(route,
 * permission)` (a separate call, because the rejected statement's transaction rolls back).
 * Step-up routes need `admin_sessions.step_up_at` within the last 10 minutes.
 */
import type { admin as adminSchemas } from '@da/validation';
import { AppError } from '../../_shared/errors.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import type { AdminDb } from '../lib/db.ts';
import type { AdminContext } from '../lib/route.ts';

type AdminAccess = adminSchemas.AdminAccess;

const OWN_ACCOUNT_CLASSES = new Set(['own', 'any_admin', 'aal1', 'bff']);

/** The first permission the admin lacks for this access rule, or `null` when access is granted. */
export function missingPermission(
  access: AdminAccess,
  permissions: ReadonlySet<string>,
): string | null {
  if (OWN_ACCOUNT_CLASSES.has(access.require)) return null;
  const primary =
    permissions.has(access.require) || (access.or ?? []).some((p) => permissions.has(p));
  if (!primary) return access.require;
  for (const extra of access.also ?? []) {
    if (!permissions.has(extra)) return extra;
  }
  return null;
}

/** The primary permission of a rule (`null` for own-account classes). */
export function primaryPermission(access: AdminAccess): string | null {
  return OWN_ACCOUNT_CLASSES.has(access.require) ? null : access.require;
}

/** Records the denial (best effort) and returns `403 FORBIDDEN {permission}`. */
export async function denied(
  db: AdminDb,
  log: Logger,
  routeKey: string,
  permission: string,
): Promise<AppError> {
  try {
    await db.call('audit_denied', { p_route: routeKey, p_permission: permission });
  } catch (cause) {
    log.warn('admin_denial_audit_failed', {
      route: routeKey,
      error_code: cause instanceof AppError ? cause.code : 'unknown',
    });
  }
  return new AppError('FORBIDDEN', { details: { permission } });
}

/** `FORBIDDEN {reason:'step_up_required'}` unless the session has a step-up within 10 minutes. */
export function assertStepUp(context: AdminContext, nowMs: number): void {
  const until = context.session.step_up_valid_until;
  if (until === null || Number.isNaN(Date.parse(until)) || Date.parse(until) <= nowMs) {
    throw new AppError('FORBIDDEN', { details: { reason: 'step_up_required' } });
  }
}
