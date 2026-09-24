import { z } from 'zod';
import { NOTIFICATION_CATEGORY_VALUES } from '@da/domain';
import {
  IanaTimeZone,
  IsoDateTime,
  JobRef,
  Locale,
  Platform,
  SemVer,
  Sha256Hex,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';

/** Android package name as reported by the NI module (API-DEV-01, API-ANI-01). */
export const AndroidPackageName = z.string().regex(/^[a-zA-Z0-9_.]{3,120}$/);

// API-DEV-01 · POST /devices/register
export const PushPermission = z.enum(['granted', 'denied', 'provisional', 'undetermined']);
export const DeviceRegisterBody = z
  .strictObject({
    installation_id: Uuid,
    platform: Platform,
    os_version: z.string().max(32),
    app_version: SemVer,
    build_number: z.string().max(16),
    locale: Locale,
    timezone: IanaTimeZone,
    push: z.strictObject({
      permission: PushPermission,
      expo_push_token: z
        .string()
        .regex(/^ExponentPushToken\[[A-Za-z0-9_-]+\]$/)
        .nullable(),
    }),
    device_fingerprint_hash: Sha256Hex.nullable(),
    android_ni: z
      .strictObject({
        available: z.boolean(),
        listener_granted: z.boolean(),
        enabled: z.boolean(),
        mode: z.enum(['all', 'selected']),
        allowed_packages: z.array(AndroidPackageName).max(200),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    const tokenAllowed =
      body.push.permission === 'granted' || body.push.permission === 'provisional';
    if (!tokenAllowed && body.push.expo_push_token !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['push', 'expo_push_token'],
        message: 'token_requires_permission',
      });
    }
  });
export const DeviceRegisterData = z.object({
  installation_id: Uuid,
  push_enabled: z.boolean(),
  rebound_from_other_user: z.boolean(),
  timezone_applied: z.boolean(),
});
export const DeviceRegisterResponse = Success(DeviceRegisterData);

// API-DEV-02 · POST /devices/unregister
export const DeviceUnregisterBody = z.strictObject({
  installation_id: Uuid,
  reason: z.enum(['logout', 'account_switch']),
});
export const DeviceUnregisterResponse = Success(z.object({ disabled_tokens: z.int().min(0) }));

// API-DEV-03 · POST /auth/apple/exchange
export const AppleExchangeBody = z.strictObject({
  authorization_code: z.string().min(10).max(2048),
  identity_token_sub: z.string().max(255),
});
export const AppleExchangeResponse = Success(z.object({ stored: z.boolean() }));

// API-DEV-04 · POST /notifications/test
export const NotificationCategory = z.enum(NOTIFICATION_CATEGORY_VALUES);
export const UserTestPushBody = z.strictObject({
  installation_id: Uuid,
  category: NotificationCategory,
});
export const UserTestPushResponse = Success(
  z.object({ notification_id: Uuid, job: JobRef, deferred_until: IsoDateTime.nullable() }),
);
