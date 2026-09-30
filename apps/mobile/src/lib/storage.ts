/**
 * Local storage layout (SECURITY_AND_PRIVACY_PLAN CTL-3.13, INTEGRATION_PLAN §8.5):
 * - SecureStore keys `da.session.key` (AES key of the session blob) and `da.mmkv.key` (AES key of
 *   the cache and preference stores), both `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, plus
 *   `da.oauth.pending` (the integration OAuth device nonce, R-07; written by the connect flow);
 * - MMKV `da-session` (the Supabase session, AES-256), `da-cache` (the persisted TanStack cache,
 *   AES-256) and `da-prefs` (non-sensitive UI preferences, AES-256);
 * - MMKV `da-install`, unencrypted: `{installation_id, first_run_done, schema_version}` only.
 * AsyncStorage is never used for any of this (lint rule plus `test/no-async-storage.test.ts`).
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';

export const SECURE_KEYS = {
  session: 'da.session.key',
  mmkv: 'da.mmkv.key',
  oauthPending: 'da.oauth.pending',
} as const;

export const MMKV_IDS = {
  install: 'da-install',
  session: 'da-session',
  cache: 'da-cache',
  prefs: 'da-prefs',
} as const;

export const INSTALL_KEYS = {
  installationId: 'installation_id',
  firstRunDone: 'first_run_done',
  schemaVersion: 'schema_version',
} as const;

/** Bumped when the local storage layout changes. */
export const STORAGE_SCHEMA_VERSION = 1;

export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** AES-256 needs a 32-byte key; 24 random bytes as base64url are 32 ASCII bytes (192 bits). */
export const STORAGE_KEY_LENGTH = 32;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url of `bytes`. */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let c = 0; c < chars; c++) out += BASE64URL.charAt((n >> (18 - 6 * c)) & 63);
  }
  return out;
}

/** A fresh random storage key from expo-crypto. */
export function newStorageKey(): string {
  return base64Url(Crypto.getRandomBytes(24));
}

let install: MMKV | undefined;

/** The unencrypted install store (created synchronously; holds no secrets). */
export function installStorage(): MMKV {
  install ??= createMMKV({ id: MMKV_IDS.install });
  return install;
}

export interface EncryptedStores {
  readonly session: MMKV;
  readonly cache: MMKV;
  readonly prefs: MMKV;
}

let stores: EncryptedStores | undefined;
let opening: Promise<EncryptedStores> | undefined;

async function readOrCreateKey(name: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(name, SECURE_STORE_OPTIONS);
  if (existing?.length === STORAGE_KEY_LENGTH) return existing;
  const key = newStorageKey();
  await SecureStore.setItemAsync(name, key, SECURE_STORE_OPTIONS);
  return key;
}

function openStore(id: string, key: string): MMKV {
  return createMMKV({ id, encryptionKey: key, encryptionType: 'AES-256' });
}

/** Opens the encrypted stores once (keys are created on first use). */
export function openEncryptedStorage(): Promise<EncryptedStores> {
  opening ??= (async () => {
    const sessionKey = await readOrCreateKey(SECURE_KEYS.session);
    const mmkvKey = await readOrCreateKey(SECURE_KEYS.mmkv);
    stores = {
      session: openStore(MMKV_IDS.session, sessionKey),
      cache: openStore(MMKV_IDS.cache, mmkvKey),
      prefs: openStore(MMKV_IDS.prefs, mmkvKey),
    };
    return stores;
  })();
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

/** The opened encrypted stores; `AppProviders` opens them before rendering the app. */
export function encryptedStorage(): EncryptedStores {
  if (stores === undefined) throw new Error('[storage] openEncryptedStorage() has not completed.');
  return stores;
}

export function isEncryptedStorageOpen(): boolean {
  return stores !== undefined;
}

/** Deletes every SecureStore key this app writes (first-run purge). */
export async function deleteSecureKeys(): Promise<void> {
  for (const key of Object.values(SECURE_KEYS)) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
  }
}

/**
 * Logout wipe (CTL-3.13 steps 4–5): the session and cache stores are emptied, the old keys are
 * deleted and replaced, and every store is re-encrypted with its new key, so nothing written before
 * the logout can be decrypted afterwards. Preferences survive (UI only), under the new key.
 */
export async function wipeAndRekeyStorage(): Promise<void> {
  const open = await openEncryptedStorage();
  open.session.clearAll();
  open.cache.clearAll();
  await deleteSecureKeys();
  const sessionKey = newStorageKey();
  const mmkvKey = newStorageKey();
  open.session.encrypt(sessionKey, 'AES-256');
  open.cache.encrypt(mmkvKey, 'AES-256');
  open.prefs.encrypt(mmkvKey, 'AES-256');
  await SecureStore.setItemAsync(SECURE_KEYS.session, sessionKey, SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(SECURE_KEYS.mmkv, mmkvKey, SECURE_STORE_OPTIONS);
}

/** Test seam: forget the opened instances. */
export function resetStorageForTests(): void {
  install = undefined;
  stores = undefined;
  opening = undefined;
}
