/**
 * LargeSecureStore (SECURITY_AND_PRIVACY_PLAN CTL-3.13, INTEGRATION_PLAN §8.5): the Supabase
 * session storage adapter. A Supabase session (JWT + refresh token + user) exceeds what SecureStore
 * is meant to hold, so the random 32-byte AES key lives in SecureStore (`da.session.key`,
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) and the ciphertext lives in the AES-256 MMKV instance
 * `da-session`; AsyncStorage is never used.
 */
import type { AuthStorage } from '@da/api-client';
import type { MMKV } from 'react-native-mmkv';

import { openEncryptedStorage } from '../storage';

/** An `AuthStorage` over any MMKV store resolved asynchronously (the key read is async). */
export function createLargeSecureStore(resolveStore: () => Promise<MMKV>): AuthStorage {
  return {
    getItem: async (key: string) => (await resolveStore()).getString(key) ?? null,
    setItem: async (key: string, value: string) => {
      (await resolveStore()).set(key, value);
    },
    removeItem: async (key: string) => {
      (await resolveStore()).remove(key);
    },
  };
}

/** The app's session storage: `da-session`, keyed by `da.session.key`. */
export const largeSecureStore: AuthStorage = createLargeSecureStore(
  async () => (await openEncryptedStorage()).session,
);
