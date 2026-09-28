/**
 * `da-platform` JS interface (KNOWN_PLATFORM_LIMITATIONS KPL-04, KPL-07, KPL-09): platform
 * capability state that no Expo API exposes, and the system settings handoffs that need typed
 * intents. Every call is guarded: a missing module (Expo Go, unit tests without the double) or a
 * native error reads as "unknown" (`null`) instead of a guessed state, so no screen ever shows a
 * capability it could not read (policy §1: never fake a capability).
 */
import { Linking, Platform } from 'react-native';

import {
  nativePlatform,
  type BatteryOptimization,
  type DaPlatformNativeModule,
  type ExactAlarmState,
  type TimeSensitiveSetting,
} from './native';

export type { BatteryOptimization, ExactAlarmState, TimeSensitiveSetting } from './native';

function run<T>(read: (module: DaPlatformNativeModule) => T | undefined): T | null {
  const module = nativePlatform();
  if (module === null) return null;
  try {
    return read(module) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether exact alarms may be scheduled. iOS calendar triggers are always exact
 * (`not_required`); on Android the special access decides; `null` when it could not be read.
 */
export function exactAlarmState(): ExactAlarmState | null {
  if (Platform.OS === 'ios') return 'not_required';
  if (Platform.OS !== 'android') return null;
  return run((module) => module.getExactAlarmState?.());
}

/** Android: opens the app's "Alarms & reminders" page; false when nothing opened. */
export function openExactAlarmSettings(): boolean {
  if (Platform.OS !== 'android') return false;
  return run((module) => module.openExactAlarmSettings?.()) === true;
}

/** iOS Time Sensitive notification setting; `null` on Android or when it could not be read. */
export async function timeSensitiveSetting(): Promise<TimeSensitiveSetting | null> {
  if (Platform.OS !== 'ios') return null;
  const module = nativePlatform();
  if (module?.getTimeSensitiveSetting === undefined) return null;
  try {
    return await module.getTimeSensitiveSetting();
  } catch {
    return null;
  }
}

/** iOS: the app's notification settings page (the app settings as the fallback). */
export async function openNotificationSettings(): Promise<boolean> {
  const module = nativePlatform();
  if (Platform.OS === 'ios' && module?.openNotificationSettings !== undefined) {
    try {
      if (await module.openNotificationSettings()) return true;
    } catch {
      // Fall through to the app settings.
    }
  }
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/** Android battery-optimisation state; `null` on iOS or when it could not be read. */
export function batteryOptimization(): BatteryOptimization | null {
  if (Platform.OS !== 'android') return null;
  return run((module) => module.getBatteryOptimization?.());
}

/** Android: the battery-optimisation list (never a direct exemption prompt). */
export function openBatteryOptimizationSettings(): boolean {
  if (Platform.OS !== 'android') return false;
  return run((module) => module.openBatteryOptimizationSettings?.()) === true;
}
