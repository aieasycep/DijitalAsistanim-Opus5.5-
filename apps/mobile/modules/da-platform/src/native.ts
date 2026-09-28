/**
 * The `DaPlatform` native module (iOS `ios/DaPlatformModule.swift`, Android
 * `expo.modules.daplatform.DaPlatformModule`). `null` where it is not linked (Expo Go, unit tests
 * unless a test installs the double from `test/setup/native-mocks.ts`).
 */
import { requireOptionalNativeModule } from 'expo';

/** Android: `AlarmManager.canScheduleExactAlarms()` (API 31+); `not_required` below API 31. */
export type ExactAlarmState = 'granted' | 'denied' | 'not_required';

/** iOS: `UNNotificationSettings.timeSensitiveSetting`. */
export type TimeSensitiveSetting = 'enabled' | 'disabled' | 'not_supported';

/** Android: `PowerManager.isIgnoringBatteryOptimizations(packageName)`. */
export type BatteryOptimization = 'exempt' | 'optimized' | 'unknown';

export interface DaPlatformNativeModule {
  /** Android only. */
  getExactAlarmState?(): ExactAlarmState;
  /** Android only: the app's "Alarms & reminders" page, else the app details page. */
  openExactAlarmSettings?(): boolean;
  /** Android only. */
  getBatteryOptimization?(): BatteryOptimization;
  /** Android only: the battery-optimisation list, else the app details page. */
  openBatteryOptimizationSettings?(): boolean;
  /** iOS only. */
  getTimeSensitiveSetting?(): Promise<TimeSensitiveSetting>;
  /** iOS only: the app's notification settings page. */
  openNotificationSettings?(): Promise<boolean>;
}

export function nativePlatform(): DaPlatformNativeModule | null {
  return requireOptionalNativeModule<DaPlatformNativeModule>('DaPlatform');
}
