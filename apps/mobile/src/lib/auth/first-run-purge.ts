/**
 * First-run keychain purge (SECURITY_AND_PRIVACY_PLAN CTL-3.13, INTEGRATION_PLAN §8.5, M-GL-02).
 * The iOS keychain survives an uninstall while the app container does not, so a reinstall would
 * find old SecureStore keys (and could resume a session the user believed gone). When the
 * unencrypted `da-install` store has no `first_run_done` flag, every SecureStore key is deleted
 * before the encrypted stores open (they then get fresh keys), the local session is signed out
 * (no network), a new `installation_id` is generated, and the flag is set last — so an interrupted
 * purge simply runs again on the next launch.
 */
import * as Crypto from 'expo-crypto';
import type { MMKV } from 'react-native-mmkv';

import {
  INSTALL_KEYS,
  STORAGE_SCHEMA_VERSION,
  deleteSecureKeys,
  installStorage,
  openEncryptedStorage,
} from '../storage';

export interface PrepareStorageDeps {
  readonly install?: () => MMKV;
  readonly purgeKeys?: () => Promise<void>;
  readonly openStorage?: () => Promise<unknown>;
  /** `supabase.auth.signOut({scope:'local'})`; errors are ignored. */
  readonly signOutLocal: () => Promise<unknown>;
  readonly newInstallationId?: () => string;
}

export interface PrepareStorageResult {
  readonly firstRun: boolean;
  readonly installationId: string;
}

/** Runs at every launch before the session is restored; purges only on the first run. */
export async function prepareSecureStorage(
  deps: PrepareStorageDeps,
): Promise<PrepareStorageResult> {
  const install = (deps.install ?? installStorage)();
  const firstRun = install.getBoolean(INSTALL_KEYS.firstRunDone) !== true;
  if (firstRun) await (deps.purgeKeys ?? deleteSecureKeys)();
  await (deps.openStorage ?? openEncryptedStorage)();
  if (firstRun) {
    try {
      await deps.signOutLocal();
    } catch {
      // Nothing to sign out on a clean install; the purge must still complete.
    }
    install.set(INSTALL_KEYS.installationId, (deps.newInstallationId ?? Crypto.randomUUID)());
    install.set(INSTALL_KEYS.schemaVersion, STORAGE_SCHEMA_VERSION);
    install.set(INSTALL_KEYS.firstRunDone, true);
  }
  const installationId = install.getString(INSTALL_KEYS.installationId);
  if (installationId === undefined) {
    const regenerated = (deps.newInstallationId ?? Crypto.randomUUID)();
    install.set(INSTALL_KEYS.installationId, regenerated);
    return { firstRun, installationId: regenerated };
  }
  return { firstRun, installationId };
}

/** This installation's id (`X-DA-Installation-Id`, `POST /devices/register`). */
export function installationId(): string | null {
  return installStorage().getString(INSTALL_KEYS.installationId) ?? null;
}
