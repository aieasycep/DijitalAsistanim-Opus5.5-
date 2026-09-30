import type { AdminPermission, AdminRole } from '@da/domain';
import type { AdminPreferences } from '@da/validation/admin/session';
import type { z } from 'zod';

/**
 * What the admin shell knows about the signed-in admin (from admin-api `GET /me`). It is passed to
 * client components for cosmetic gating only (BACKOFFICE_PLAN §4.3 layer 1): admin-api and SQL
 * re-check every permission. It never holds a token.
 */
export interface AdminContext {
  readonly admin: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly role: AdminRole;
    readonly mfaFactorCount: number;
    readonly recoveryCodesRemaining: number;
  };
  readonly permissions: readonly AdminPermission[];
  readonly session: {
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
    readonly stepUpValidUntil: string | null;
    /** admin-api `meta.server_time` of the `/me` answer, to turn deadlines into durations. */
    readonly serverTime: string;
  };
  readonly preferences: z.infer<typeof AdminPreferences>;
}

/** True when any of `required` is held (sidebar rows list alternatives, §5.2). */
export function hasAnyPermission(
  held: readonly string[],
  required: readonly string[] | 'always',
): boolean {
  if (required === 'always') return true;
  return required.some((permission) => held.includes(permission));
}

/** Milliseconds from `serverTime` to `deadline` (client clocks may be skewed; durations are not). */
export function remainingMs(deadline: string, serverTime: string): number {
  return Date.parse(deadline) - Date.parse(serverTime);
}
