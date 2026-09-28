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

/**
 * `app_installations.platform_capabilities` (DATABASE_AND_RLS_PLAN §4.1: an object of booleans;
 * KNOWN_PLATFORM_LIMITATIONS KPL-04/06/07/09/11/17/19/24/25): what this installation can do right
 * now, for support visibility. It never changes server behaviour. A key the device could not read
 * is omitted, never guessed.
 */
export const PlatformCapabilities = z.strictObject({
  /** Android: exact alarms may be scheduled (`canScheduleExactAlarms()`; true below API 31). */
  exact_alarm: z.boolean().optional(),
  /** iOS: Time Sensitive notifications are allowed (`timeSensitiveSetting == .enabled`). */
  ios_time_sensitive: z.boolean().optional(),
  /** iOS: notification previews are shown always (`showPreviewsSetting == .always`). */
  ios_show_previews: z.boolean().optional(),
  /** Android: the notification-listener API exists on this device. */
  ni_available: z.boolean().optional(),
  /** Android: notification access is granted in the system settings. */
  ni_granted: z.boolean().optional(),
  /** Android: the system has the listener bound right now (KPL-04). */
  ni_connected: z.boolean().optional(),
  /** The OS allows background tasks (`expo-background-task` status `Available`). */
  background_task: z.boolean().optional(),
  /** Placed widget families: iOS home screen. */
  widget_small: z.boolean().optional(),
  widget_medium: z.boolean().optional(),
  widget_large: z.boolean().optional(),
  /** Placed widget families: iOS Lock Screen. */
  widget_lock_inline: z.boolean().optional(),
  widget_lock_circular: z.boolean().optional(),
  widget_lock_rectangular: z.boolean().optional(),
  /** Placed widget families: Android 2×2 "Sıradaki" and 4×2 "Bugün". */
  widget_next: z.boolean().optional(),
  widget_today: z.boolean().optional(),
  /** On-device Turkish speech recognition is available (KPL-24). */
  stt_on_device_tr: z.boolean().optional(),
  /** A Turkish text-to-speech voice is installed (KPL-25). */
  tts_tr_voice: z.boolean().optional(),
});
export type PlatformCapabilities = z.infer<typeof PlatformCapabilities>;

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
    /** Replaces `app_installations.platform_capabilities` when present (absent: unchanged). */
    platform_capabilities: PlatformCapabilities.optional(),
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
