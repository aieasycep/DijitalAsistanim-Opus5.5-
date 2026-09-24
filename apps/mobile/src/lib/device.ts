/**
 * Device facts sent to the `api` (API_CONTRACTS §2.2 `X-DA-Client`, API-DEV-01 body). Nothing here
 * identifies the person: the installation id is a random per-install UUID.
 */
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deviceLocale, deviceTimeZone } from '../i18n/I18nProvider';
import { getUiPrefs } from './ui-prefs';

/** `1.2` → `1.2.0`; anything unparsable → `0.0.0` (the server then asks for an update). */
export function semver(version: string | null | undefined): string {
  const parts = (version ?? '').split('.').map((p) => Number.parseInt(p, 10));
  const [major = 0, minor = 0, patch = 0] = parts.map((n) =>
    Number.isFinite(n) && n >= 0 ? n : 0,
  );
  return `${String(major)}.${String(minor)}.${String(patch)}`;
}

export function appVersion(): string {
  return semver(Application.nativeApplicationVersion);
}

export function buildNumber(): string {
  return (Application.nativeBuildVersion ?? '0').slice(0, 16);
}

export function platform(): 'ios' | 'android' {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

/** `X-DA-Client`: `ios/1.0.0 (42)`. */
export function clientHeader(): string {
  return `${platform()}/${appVersion()} (${buildNumber()})`;
}

export function osVersion(): string {
  return String(Platform.Version).slice(0, 32);
}

/** The API locale: the explicit in-app language, else the device language. */
export function apiLocale(): 'tr-TR' | 'en-US' {
  return (getUiPrefs().locale ?? deviceLocale()) === 'en' ? 'en-US' : 'tr-TR';
}

export function deviceZone(): string {
  return getUiPrefs().timeZone ?? deviceTimeZone();
}

export type PushPermission = 'granted' | 'denied' | 'provisional' | 'undetermined';

/** The OS notification permission without prompting (the prompt belongs to onboarding). */
export async function pushPermission(): Promise<PushPermission> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return 'provisional';
    }
    return settings.status === Notifications.PermissionStatus.GRANTED
      ? 'granted'
      : settings.status === Notifications.PermissionStatus.DENIED
        ? 'denied'
        : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/** `POST /devices/register` body without a push token (T-8.24 adds the token after the prompt). */
export async function deviceRegisterBody(installationId: string) {
  return {
    installation_id: installationId,
    platform: platform(),
    os_version: osVersion(),
    app_version: appVersion(),
    build_number: buildNumber(),
    locale: apiLocale(),
    timezone: deviceTimeZone(),
    push: { permission: await pushPermission(), expo_push_token: null },
    device_fingerprint_hash: null,
  };
}
