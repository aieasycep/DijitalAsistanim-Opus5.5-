/**
 * Push registration (T-8.24; API-DEV-01, INTEGRATION_PLAN §9.2, SCREEN_AND_FLOW_MAP M-ON-14):
 * 1. the channels exist before the OS prompt (Android 13+ needs one to show the prompt);
 * 2. the OS prompt runs only from a user action (onboarding "Bildirimleri Aç", the settings
 *    banner, the reminder sheet), never on its own;
 * 3. with permission, `getExpoPushTokenAsync({projectId})` (the EAS project id from the app
 *    config; without it — an external credential — only the token is skipped);
 * 4. `POST /devices/register` with the installation id, platform, OS and app versions, locale, time
 *    zone and `push:{permission, expo_push_token}`. The body schema is strict and has no channel
 *    list: channels are device-side only.
 * Registration re-runs after sign-in, on cold start and foreground when anything in the body
 * changed (token rotation, permission, locale, time zone, app version), and on token rotation
 * (`addPushTokenListener`). Logout unregisters (`logout.ts`) and forgets the stored registration.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';

import { installationId } from '../auth/first-run-purge';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../auth/logout';
import { getApiClient } from '../bootstrap';
import { deviceRegisterBody } from '../device';
import { setupNotificationChannels } from './channels';
import {
  cachedPushToken,
  forgetPushRegistration,
  registeredSignature,
  rememberPushToken,
  rememberRegisteredSignature,
} from './token';

export type OsPermission = 'granted' | 'denied' | 'blocked' | 'undetermined';

function toPermission(response: {
  readonly status: string;
  readonly canAskAgain?: boolean;
}): OsPermission {
  if (response.status === 'granted') return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  return response.canAskAgain === false ? 'blocked' : 'denied';
}

export async function currentNotificationPermission(): Promise<OsPermission> {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

/** The OS prompt (channels first). Call only from a user action. */
export async function requestNotificationPermission(): Promise<OsPermission> {
  await setupNotificationChannels();
  return toPermission(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    }),
  );
}

/** The EAS project id baked into the app config (`extra.eas.projectId`). */
export function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

async function fetchPushToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (projectId === undefined) return null;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

type RegisterBody = Awaited<ReturnType<typeof deviceRegisterBody>>;

function signatureOf(body: RegisterBody): string {
  return JSON.stringify([
    body.installation_id,
    body.push.permission,
    body.push.expo_push_token,
    body.locale,
    body.timezone,
    body.app_version,
    body.build_number,
  ]);
}

export interface RegisterOptions {
  /**
   * `true` (default, after a permission grant or a language change): always register.
   * `false` (cold start, foreground): only when something in the body changed.
   */
  readonly force?: boolean;
}

/**
 * Registers this installation with its current push token (when permitted). Returns whether a
 * token was registered; failures are silent (retried on the next foreground).
 */
export async function registerPushToken(options: RegisterOptions = {}): Promise<boolean> {
  const install = installationId();
  if (install === null) return false;
  await setupNotificationChannels();
  const base = await deviceRegisterBody(install);
  const permitted = base.push.permission === 'granted' || base.push.permission === 'provisional';
  const token = permitted ? await fetchPushToken() : null;
  if (token !== null) rememberPushToken(token);
  const body: RegisterBody = {
    ...base,
    push: { permission: base.push.permission, expo_push_token: permitted ? token : null },
  };
  const signature = signatureOf(body);
  const previous = registeredSignature();
  // Nothing to tell the server: never registered with a token or permission, or unchanged.
  if (options.force === false && (signature === previous || (previous === null && !permitted))) {
    return token !== null;
  }
  try {
    await getApiClient().call(
      'POST /devices/register',
      { body },
      { idempotencyKey: Crypto.randomUUID() },
    );
    rememberRegisteredSignature(signature);
  } catch {
    return false;
  }
  return token !== null;
}

/** Cold start and foreground: registers only what changed since the last registration. */
export function syncPushRegistration(): Promise<boolean> {
  return registerPushToken({ force: false });
}

/** Re-registers when Expo rotates the device token. */
export function bindPushTokenRefresh(): () => void {
  const subscription = Notifications.addPushTokenListener(() => {
    void registerPushToken();
  });
  return () => {
    subscription.remove();
  };
}

/** Whether this device holds a registered token (settings "test push" availability). */
export function hasPushToken(): boolean {
  return cachedPushToken() !== null;
}

registerLogoutCleanup(LOGOUT_HOOKS.pushRegistration, forgetPushRegistration);
