/**
 * `platform_capabilities` of `POST /devices/register` (API-DEV-01; DATABASE_AND_RLS_PLAN §4.1
 * `app_installations.platform_capabilities`; KNOWN_PLATFORM_LIMITATIONS KPL-04/06/07/09/11/17/19/
 * 24/25): what this installation can do right now, read from the OS, for support visibility. Every
 * value is a boolean the device actually read; a probe that fails or does not apply leaves its key
 * out (never a guess). The registration signature includes the object, so a change (exact alarms
 * granted, Time Sensitive turned off, a widget placed, the listener unbound) is reported on the next
 * foreground (`lib/notifications/register.ts`).
 */
import type { PlatformCapabilities } from '@da/validation';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { exactAlarmState, timeSensitiveSetting } from '../../modules/da-platform/src';
import * as DaWidgets from '../../modules/da-widgets/src';
import { isNiSupported, niCall } from '../features/android-ni/native';
import { hasTurkishVoice, onDeviceRecognition } from '../features/voice/availability';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** `Notifications.IosAllowsPreviews.ALWAYS` (0 never, 1 always, 2 when unlocked). */
const IOS_PREVIEWS_ALWAYS = 1;

/** iOS home-screen and Lock Screen families (`DaWidgetsModule.bit(for:)`). */
const IOS_WIDGET_BITS = [
  ['widget_small', 1],
  ['widget_medium', 2],
  ['widget_large', 4],
  ['widget_lock_inline', 8],
  ['widget_lock_circular', 16],
  ['widget_lock_rectangular', 32],
] as const;

/** Android Glance receivers (`DaWidgetsModule.getInventory`). */
const ANDROID_WIDGET_BITS = [
  ['widget_next', 1],
  ['widget_today', 2],
] as const;

async function settle<T>(probe: () => Promise<T> | T): Promise<T | null> {
  try {
    return await probe();
  } catch {
    return null;
  }
}

/** Reads every capability this platform has; nothing here prompts the user. */
export async function platformCapabilities(): Promise<PlatformCapabilities> {
  const out: Mutable<PlatformCapabilities> = {};
  const android = Platform.OS === 'android';

  if (android) {
    const exact = exactAlarmState();
    if (exact !== null) out.exact_alarm = exact !== 'denied';
    if (isNiSupported()) {
      out.ni_available = true;
      const state = niCall(null, (ni) => ni.getListenerState?.() ?? null);
      const granted = state?.granted ?? niCall(null, (ni) => ni.isGranted());
      if (granted !== null) out.ni_granted = granted;
      if (state !== null) out.ni_connected = state.connected;
    }
  } else {
    const timeSensitive = await timeSensitiveSetting();
    if (timeSensitive !== null) out.ios_time_sensitive = timeSensitive === 'enabled';
    const settings = await settle(() => Notifications.getPermissionsAsync());
    const previews = (settings?.ios as { allowsPreviews?: number | null } | undefined)
      ?.allowsPreviews;
    if (typeof previews === 'number') out.ios_show_previews = previews === IOS_PREVIEWS_ALWAYS;
  }

  const background = await settle(() => BackgroundTask.getStatusAsync());
  if (background !== null) {
    out.background_task = background === BackgroundTask.BackgroundTaskStatus.Available;
  }

  if (DaWidgets.isWidgetBridgeAvailable()) {
    const inventory = await settle(() => DaWidgets.getInventory());
    if (inventory !== null) {
      if (android) {
        for (const [key, bit] of ANDROID_WIDGET_BITS)
          out[key] = (inventory.android_kinds & bit) !== 0;
      } else {
        for (const [key, bit] of IOS_WIDGET_BITS) out[key] = (inventory.ios_families & bit) !== 0;
      }
    }
  }

  const stt = await settle(() => onDeviceRecognition('tr-TR'));
  if (stt !== null && stt !== 'unknown') out.stt_on_device_tr = stt === 'available';
  const voice = await settle(() => hasTurkishVoice());
  if (voice !== null) out.tts_tr_voice = voice;

  return out;
}
