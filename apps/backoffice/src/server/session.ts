import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { sessionRedirect } from '@/lib/error-copy';
import type { AdminContext } from '@/lib/admin-context';
import { adminApi, type AdminApiFailure } from './admin-api';

/** Thrown when `/me` fails for a reason other than the session; rendered by the error boundary. */
export class AdminApiRequestError extends Error {
  readonly failure: AdminApiFailure;
  constructor(failure: AdminApiFailure) {
    super(`admin-api ${failure.code} (${failure.correlationId})`);
    this.name = 'AdminApiRequestError';
    this.failure = failure;
  }
}

/**
 * The signed-in admin for this request: `GET /me` with `x-da-activity: user` (a page view is admin
 * activity and extends the idle window, BACKOFFICE_PLAN §3.7). Session failures redirect to /login
 * or /mfa; a non-admin identity is signed out through `/login?reason=not_admin`. Deduplicated per
 * request. Never contains tokens: only identity, permissions, session deadlines and preferences.
 */
export const loadAdminContext = cache(async (): Promise<AdminContext> => {
  const result = await adminApi('GET /me', {}, { activity: 'user' });
  if (!result.ok) {
    const to = sessionRedirect(result.error);
    if (to !== null) redirect(to);
    if (result.error.code === 'FORBIDDEN') redirect('/login?reason=not_admin');
    throw new AdminApiRequestError(result.error);
  }
  const me = result.data;
  return {
    admin: {
      id: me.admin.id,
      email: me.admin.email,
      displayName: me.admin.display_name,
      role: me.admin.role,
      mfaFactorCount: me.admin.mfa_factor_count,
      recoveryCodesRemaining: me.admin.recovery_codes_remaining,
    },
    permissions: me.permissions,
    session: {
      idleExpiresAt: me.session.idle_expires_at,
      absoluteExpiresAt: me.session.absolute_expires_at,
      stepUpValidUntil: me.session.step_up_valid_until,
      serverTime: result.meta.server_time,
    },
    preferences: me.preferences,
  };
});
