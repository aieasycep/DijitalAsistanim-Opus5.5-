/**
 * What the device remembers about sign-in (SCREEN_AND_FLOW_MAP §0.4 `useAuthStore`):
 * `lastMethod` and `hasSignedInBefore`, in the encrypted `da-prefs` store. They survive logout so a
 * returning user lands on "Tekrar hoş geldin" instead of the intro.
 */
import { encryptedStorage, isEncryptedStorageOpen } from '../storage';
import type { AuthMethod } from './result';

const LAST_METHOD_KEY = 'auth.last_method';
const SIGNED_IN_BEFORE_KEY = 'auth.has_signed_in_before';
const METHODS: readonly AuthMethod[] = ['apple', 'google', 'microsoft', 'email_otp'];

export function rememberSignIn(method: AuthMethod): void {
  if (!isEncryptedStorageOpen()) return;
  const prefs = encryptedStorage().prefs;
  prefs.set(LAST_METHOD_KEY, method);
  prefs.set(SIGNED_IN_BEFORE_KEY, true);
}

export function hasSignedInBefore(): boolean {
  return (
    isEncryptedStorageOpen() && encryptedStorage().prefs.getBoolean(SIGNED_IN_BEFORE_KEY) === true
  );
}

export function lastSignInMethod(): AuthMethod | null {
  if (!isEncryptedStorageOpen()) return null;
  const value = encryptedStorage().prefs.getString(LAST_METHOD_KEY);
  return METHODS.includes(value as AuthMethod) ? (value as AuthMethod) : null;
}
