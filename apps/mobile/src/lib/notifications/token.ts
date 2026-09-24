/**
 * This installation's Expo push token and the fingerprint of its last `POST /devices/register`
 * (T-8.24), kept in the encrypted preference store so a cold start re-registers only when the
 * token, the permission, the locale, the time zone or the app version changed. Logout forgets both
 * (the token is invalidated by `/devices/unregister` and `unregisterForNotificationsAsync`).
 */
import { encryptedStorage, isEncryptedStorageOpen } from '../storage';

const TOKEN_KEY = 'push.expo_token';
const SIGNATURE_KEY = 'push.registered_signature';

let memoryToken: string | null = null;
let memorySignature: string | null = null;

export function cachedPushToken(): string | null {
  if (!isEncryptedStorageOpen()) return memoryToken;
  return encryptedStorage().prefs.getString(TOKEN_KEY) ?? memoryToken;
}

export function rememberPushToken(token: string | null): void {
  memoryToken = token;
  if (!isEncryptedStorageOpen()) return;
  if (token === null) encryptedStorage().prefs.remove(TOKEN_KEY);
  else encryptedStorage().prefs.set(TOKEN_KEY, token);
}

export function registeredSignature(): string | null {
  if (!isEncryptedStorageOpen()) return memorySignature;
  return encryptedStorage().prefs.getString(SIGNATURE_KEY) ?? memorySignature;
}

export function rememberRegisteredSignature(signature: string | null): void {
  memorySignature = signature;
  if (!isEncryptedStorageOpen()) return;
  if (signature === null) encryptedStorage().prefs.remove(SIGNATURE_KEY);
  else encryptedStorage().prefs.set(SIGNATURE_KEY, signature);
}

export function forgetPushRegistration(): void {
  rememberPushToken(null);
  rememberRegisteredSignature(null);
}
