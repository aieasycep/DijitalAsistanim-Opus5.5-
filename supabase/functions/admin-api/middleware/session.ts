/**
 * Admin session context (BACKOFFICE_PLAN §2.5 step 4, §3.7; API_CONTRACTS ADM-00).
 *
 * `admin_api.admin_me(p_activity)` re-checks the gateway header, `aal2`, the active `admin_users`
 * row and the `admin_sessions` row (idle ≤ 30 min, absolute ≤ 12 h, `app_settings` session.*),
 * applies the read-class rate limit and returns `{admin, permissions[], session, preferences}`.
 * Background polling (`x-da-activity: background`) never extends the idle window.
 *
 * A guard rejection rolls its own transaction back, so on `ADMIN_SESSION_EXPIRED` the pipeline
 * persists the end through `admin_api.session_expire()` and answers
 * `401 AUTH_REQUIRED {reason:'admin_session_expired', end_reason}`.
 */
import { AppError } from '../../_shared/errors.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import { type AdminDb, guardFailureOf } from '../lib/db.ts';
import { count, type Json, obj, str } from '../lib/map.ts';
import type { AdminContext } from '../lib/route.ts';

/** `x-da-activity: background` → `false`; anything else is user activity. */
export function activityOf(header: string | undefined): boolean {
  return header?.trim().toLowerCase() !== 'background';
}

export function toAdminContext(me: Json): AdminContext {
  const admin = obj(me.admin);
  const session = obj(me.session);
  const permissions = new Set<string>(
    Array.isArray(me.permissions)
      ? (me.permissions as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
  );
  return {
    adminId: (str(admin.id) ?? '').toLowerCase(),
    role: str(admin.role),
    permissions,
    session: {
      id: str(session.id),
      idle_expires_at: str(session.idle_expires_at),
      absolute_expires_at: str(session.absolute_expires_at),
      step_up_valid_until: str(session.step_up_valid_until),
    },
    recoveryCodesRemaining: count(admin.recovery_codes_remaining),
    me,
  };
}

/**
 * Persists an expired session end (best effort: the rejection itself already stands) and returns
 * the error with the end reason for the backoffice redirect (`idle`, `absolute`, `revoked`).
 */
export async function expireSession(db: AdminDb, log: Logger, error: AppError): Promise<AppError> {
  let endReason = 'revoked';
  try {
    const out = obj(await db.call('session_expire'));
    const reason = str(out.end_reason);
    if (reason !== null) endReason = reason;
  } catch (cause) {
    log.warn('admin_session_expire_failed', {
      error_code: cause instanceof AppError ? cause.code : 'unknown',
    });
  }
  return new AppError('AUTH_REQUIRED', {
    details: { ...(error.details ?? {}), reason: 'admin_session_expired', end_reason: endReason },
  });
}

/** Loads the context; an expired session is ended and reported. */
export async function loadAdminContext(
  db: AdminDb,
  log: Logger,
  activity: boolean,
): Promise<AdminContext> {
  try {
    return toAdminContext(obj(await db.call('admin_me', { p_activity: activity })));
  } catch (error) {
    if (error instanceof AppError && guardFailureOf(error) === 'session_expired') {
      throw await expireSession(db, log, error);
    }
    throw error;
  }
}
