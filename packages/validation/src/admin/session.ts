import { z } from 'zod';
import { ADMIN_STATUS_VALUES } from '@da/domain';
import {
  Email,
  hasDefinedValue,
  IanaTimeZone,
  IsoDateTime,
  Sha256Hex,
  Uuid,
} from '../api/common.ts';
import {
  AdminPermission,
  AdminRole,
  Confirm,
  EmptyAdminBody,
  MetricsRange,
  Success,
} from './common.ts';

/* ADM-00 · Session and preferences (§12.3). */

const AdminIdentity = z.object({
  id: Uuid,
  email: Email,
  role: AdminRole,
  mfa_enrolled: z.boolean(),
});

// POST /session/start
export const SessionStartBody = EmptyAdminBody;
export const SessionStartResponse = Success(
  z.object({
    admin: AdminIdentity,
    permissions: z.array(AdminPermission),
    idle_expires_at: IsoDateTime,
    absolute_expires_at: IsoDateTime,
  }),
);

// POST /session/heartbeat
export const SessionHeartbeatBody = EmptyAdminBody;
export const SessionHeartbeatResponse = Success(z.object({ idle_expires_at: IsoDateTime }));

// GET /me
export const AdminMeHeaders = z.object({
  'x-da-activity': z.enum(['user', 'background']).default('user'),
});
export const AdminPreferences = z.object({
  theme: z.enum(['light', 'dark']),
  locale: z.enum(['tr', 'en']),
  timezone: IanaTimeZone,
  density: z.enum(['comfortable', 'compact']),
  table_prefs: z.record(z.string(), z.unknown()),
  dashboard_range: MetricsRange,
  recent_items: z.array(z.object({ type: z.string(), id: z.string(), label: z.string() })).max(10),
  sidebar_collapsed: z.boolean(),
});
export const AdminMeResponse = Success(
  z.object({
    admin: z.object({
      id: Uuid,
      email: Email,
      display_name: z.string().nullable(),
      role: AdminRole,
      status: z.enum(ADMIN_STATUS_VALUES),
      mfa_enrolled: z.boolean(),
      mfa_factor_count: z.int().min(0),
      recovery_codes_remaining: z.int().min(0),
    }),
    permissions: z.array(AdminPermission),
    session: z.object({
      id: Uuid,
      idle_expires_at: IsoDateTime,
      absolute_expires_at: IsoDateTime,
      step_up_valid_until: IsoDateTime.nullable(),
    }),
    preferences: AdminPreferences,
  }),
);

// GET /me/sessions — never `ip_hash` or the raw user agent (strict row).
export const AdminOwnSession = z.strictObject({
  id: Uuid,
  current: z.boolean(),
  aal: z.enum(['aal1', 'aal2']),
  created_at: IsoDateTime,
  last_activity_at: IsoDateTime,
  idle_expires_at: IsoDateTime,
  absolute_expires_at: IsoDateTime,
  ended_at: IsoDateTime.nullable(),
  end_reason: z.string().nullable(),
  browser_family: z.string().max(80),
});
export const AdminSessionsResponse = Success(z.array(AdminOwnSession).max(20));

// POST /session/logout, POST /session/logout-all
export const SessionLogoutBody = EmptyAdminBody;
export const SessionLogoutAllBody = z.strictObject({
  confirm: Confirm,
  scope: z.enum(['all', 'others']).default('all'),
});
export const SessionEndedResponse = Success(z.object({ ended_sessions: z.int().min(0) }));

// GET /preferences, PATCH /preferences
export const AdminPreferencesResponse = Success(AdminPreferences);
export const AdminPreferencesPatch = z
  .strictObject({
    theme: z.enum(['light', 'dark']).optional(),
    locale: z.enum(['tr', 'en']).optional(),
    timezone: IanaTimeZone.optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    table_prefs: z.record(z.string(), z.unknown()).optional(),
    dashboard_range: MetricsRange.optional(),
    recent_items: z
      .array(
        z.strictObject({
          type: z.string().max(32),
          id: z.string().max(80),
          label: z.string().max(120),
        }),
      )
      .max(10)
      .optional(),
    sidebar_collapsed: z.boolean().optional(),
  })
  .refine(hasDefinedValue, 'no_changes');

// BFF-only auth routes
export const AuthPreflightBody = z.strictObject({ email_hash: Sha256Hex, ip_hash: Sha256Hex });
export const AuthPreflightResponse = Success(
  z.object({
    allowed: z.boolean(),
    retry_after: z.int().min(0).optional(),
    locked: z.boolean().optional(),
  }),
);
export const AuthAttemptBody = z.strictObject({
  email_hash: Sha256Hex,
  ip_hash: Sha256Hex,
  kind: z.enum(['email_otp', 'mfa']),
  success: z.boolean(),
});
export const AuthAttemptResponse = Success(z.object({ recorded: z.literal(true) }));
export const AuthStatusResponse = Success(
  z.object({
    is_admin: z.boolean(),
    status: z.enum(ADMIN_STATUS_VALUES).nullable(),
    mfa_verified_factors: z.int().min(0),
  }),
);
export const InviteRedeemBody = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const InviteRedeemResponse = Success(z.object({ email: Email, accepted: z.literal(true) }));
export const RecoveryCodeRedeemBody = z.strictObject({
  code: z.string().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{2,4}$/),
});
export const RecoveryCodeRedeemResponse = Success(
  z.object({ factors_removed: z.int().min(0), reenrol_required: z.literal(true) }),
);
export const RecoveryCodesBody = EmptyAdminBody;
export const RecoveryCodesResponse = Success(
  z.object({ codes: z.array(z.string()).length(10), generated_at: IsoDateTime }),
);
export const StepUpBody = EmptyAdminBody;
export const StepUpResponse = Success(z.object({ step_up_valid_until: IsoDateTime }));
