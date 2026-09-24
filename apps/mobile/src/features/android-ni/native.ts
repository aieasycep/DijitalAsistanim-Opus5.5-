/**
 * The app's handle on the `notification-intelligence` module (T-8.26). Every call is guarded: a
 * missing module (iOS, Expo Go, tests without a double) or a native error reads as "unsupported"
 * or an empty result instead of throwing into a screen. Tests install a double with
 * `setNotificationIntelligenceForTests`.
 */
import { Platform } from 'react-native';

import {
  loadNotificationIntelligence,
  type NotificationIntelligenceNative,
} from '../../../modules/notification-intelligence/src';

export type {
  NiCandidateApp,
  NiCategory,
  NiLockedGroup,
  NiMode,
  NiRecentSignal,
  NiSignal,
  NiState,
  NiTrackingStatus,
  NotificationIntelligenceNative,
} from '../../../modules/notification-intelligence/src';

let override: NotificationIntelligenceNative | null | undefined;
let loaded: NotificationIntelligenceNative | null | undefined;

/** The native module, or null when this device has none. */
export function niModule(): NotificationIntelligenceNative | null {
  if (override !== undefined) return override;
  loaded ??= loadNotificationIntelligence();
  return loaded;
}

/** Android and a module whose listener API exists on this device. */
export function isNiSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  const ni = niModule();
  if (ni === null) return false;
  try {
    return ni.isAvailable();
  } catch {
    return false;
  }
}

/** Runs a module call; a missing module or a native error yields `fallback`. */
export function niCall<T>(fallback: T, run: (ni: NotificationIntelligenceNative) => T): T {
  const ni = niModule();
  if (ni === null) return fallback;
  try {
    return run(ni);
  } catch {
    return fallback;
  }
}

/** `undefined` restores the real module; `null` simulates a device without one. */
export function setNotificationIntelligenceForTests(
  next: NotificationIntelligenceNative | null | undefined,
): void {
  override = next;
}
