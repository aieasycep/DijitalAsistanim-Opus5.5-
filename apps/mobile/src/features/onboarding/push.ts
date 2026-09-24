/**
 * Notification permission for onboarding (M-ON-14, R-12/R-14): the Android channels are created
 * first (so the Android 13+ `POST_NOTIFICATIONS` prompt appears at all), then the OS prompt, then
 * the Expo push token is registered with `POST /devices/register {push:{permission,
 * expo_push_token}}` (API-DEV-01). A missing EAS project or push credential (external credential)
 * only skips the token; the flow continues. Provisional authorization is not used.
 */
import { ANDROID_CHANNELS } from '@da/domain/notifications/channels';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translator } from '../../i18n/translate';
import { installationId } from '../../lib/auth/first-run-purge';
import { getApiClient } from '../../lib/bootstrap';
import { deviceRegisterBody } from '../../lib/device';

export type OsPermission = 'granted' | 'denied' | 'blocked' | 'undetermined';

function toPermission(response: {
  readonly status: string;
  readonly canAskAgain?: boolean;
}): OsPermission {
  if (response.status === 'granted') return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  return response.canAskAgain === false ? 'blocked' : 'denied';
}

const IMPORTANCE = {
  high: Notifications.AndroidImportance.HIGH,
  default: Notifications.AndroidImportance.DEFAULT,
  low: Notifications.AndroidImportance.LOW,
} as const;

/** Creates the R-12 channels (idempotent; Android only). */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const t = translator();
  for (const channel of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: t(`push.channels.${channel.id}.name`),
      description: t(`push.channels.${channel.id}.description`),
      importance: IMPORTANCE[channel.importance],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => undefined);
  }
}

export async function currentNotificationPermission(): Promise<OsPermission> {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<OsPermission> {
  await ensureAndroidChannels();
  return toPermission(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    }),
  );
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/** Registers this installation with its push token; false when no token could be obtained. */
export async function registerPushToken(): Promise<boolean> {
  const install = installationId();
  if (install === null) return false;
  let token: string | null = null;
  try {
    const id = projectId();
    if (id !== undefined) {
      token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    }
  } catch {
    token = null;
  }
  const body = await deviceRegisterBody(install);
  try {
    await getApiClient().call('POST /devices/register', {
      body: {
        ...body,
        push: {
          permission: body.push.permission,
          expo_push_token:
            body.push.permission === 'granted' || body.push.permission === 'provisional'
              ? token
              : null,
        },
      },
    });
  } catch {
    return false;
  }
  return token !== null;
}
