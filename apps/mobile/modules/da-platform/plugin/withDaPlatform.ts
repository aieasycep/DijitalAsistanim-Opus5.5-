/**
 * `da-platform` config plugin (KNOWN_PLATFORM_LIMITATIONS KPL-07, KPL-09). The module reads two
 * capabilities that exist only when the build declares them, so the plugin owns both declarations:
 * - Android: `SCHEDULE_EXACT_ALARM` (the user-granted "Alarms & reminders" special access; without
 *   it `canScheduleExactAlarms()` is always false on Android 12+). `USE_EXACT_ALARM` stays blocked
 *   (Play-restricted), as does `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (never declared).
 * - iOS: the `com.apple.developer.usernotifications.time-sensitive` entitlement (without it
 *   `timeSensitiveSetting` is `notSupported`; the capability is a manual step in the Apple
 *   Developer portal).
 * Both are plain config values, so the result is visible in `expo config` and asserted by the
 * prebuild smoke in the generated manifest and entitlements.
 */
import type { ExpoConfig } from 'expo/config';

export const EXACT_ALARM_PERMISSION = 'android.permission.SCHEDULE_EXACT_ALARM';
export const TIME_SENSITIVE_ENTITLEMENT = 'com.apple.developer.usernotifications.time-sensitive';
/** Declared nowhere; listed so the plugin refuses a config that would request them. */
export const RESTRICTED_PERMISSIONS = [
  'android.permission.USE_EXACT_ALARM',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
] as const;

function fullName(permission: string): string {
  return permission.includes('.') ? permission : `android.permission.${permission}`;
}

/** Adds the permission and the entitlement (idempotent); throws on a restricted permission. */
export function withDaPlatform(config: ExpoConfig): ExpoConfig {
  const requested = config.android?.permissions ?? [];
  for (const permission of requested) {
    if ((RESTRICTED_PERMISSIONS as readonly string[]).includes(fullName(permission))) {
      throw new Error(
        `[da-platform] ${fullName(permission)} is Play-restricted and never declared.`,
      );
    }
  }
  const hasExactAlarm = requested.some((p) => fullName(p) === EXACT_ALARM_PERMISSION);
  return {
    ...config,
    android: {
      ...config.android,
      // The short form, like the rest of `android.permissions` (Expo prefixes it).
      permissions: hasExactAlarm ? requested : [...requested, 'SCHEDULE_EXACT_ALARM'],
    },
    ios: {
      ...config.ios,
      entitlements: { ...config.ios?.entitlements, [TIME_SENSITIVE_ENTITLEMENT]: true },
    },
  };
}
