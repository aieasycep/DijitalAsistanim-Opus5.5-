/**
 * Android NI lifecycle (T-8.26), imported by the root layout:
 * - sign-out (`LOGOUT_HOOKS.niBuffer`): the encrypted buffer, the seen counts and the listener
 *   settings are wiped, and the background upload is unregistered;
 * - foreground: the entitlement is reconciled (Pro ended → the analysis pauses; Pro back → it
 *   resumes), a pending `POST /devices/register {android_ni}` mirror is retried and the buffer is
 *   uploaded; new signals arriving while the app is open are uploaded shortly after;
 * - the `expo-background-task` tick (`da-ani-upload`, ≥ 15 min) uploads while the app is closed.
 * Nothing runs on iOS.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Crypto from 'expo-crypto';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { installationId } from '../../lib/auth/first-run-purge';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../lib/auth/logout';
import { getApiClient } from '../../lib/bootstrap';
import { deviceRegisterBody } from '../../lib/device';
import { encryptedStorage, isEncryptedStorageOpen, openEncryptedStorage } from '../../lib/storage';
import { pausedByLapse, setPausedByLapse } from './choice';
import { isNiSupported, niCall, niModule } from './native';
import { flushAniSignals, isNiEntitled } from './upload';

export const ANI_UPLOAD_TASK = 'da-ani-upload';
const REPORT_PENDING_KEY = 'ani.report_pending';
const SIGNAL_FLUSH_DELAY_MS = 5_000;

/** Mirrors the listener state to the server (API-DEV-01); retried on the next foreground. */
export async function reportAniState(): Promise<boolean> {
  const install = installationId();
  const setPending = (value: boolean) => {
    if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(REPORT_PENDING_KEY, value);
  };
  if (install === null) return false;
  try {
    await getApiClient().call(
      'POST /devices/register',
      { body: await deviceRegisterBody(install) },
      { idempotencyKey: Crypto.randomUUID() },
    );
    setPending(false);
    return true;
  } catch {
    setPending(true);
    return false;
  }
}

function reportPending(): boolean {
  return (
    isEncryptedStorageOpen() && encryptedStorage().prefs.getBoolean(REPORT_PENDING_KEY) === true
  );
}

/** Registers or removes the background upload task with the analysis switch. */
export async function syncBackgroundUpload(enabled: boolean): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(ANI_UPLOAD_TASK);
    if (enabled && !registered) {
      await BackgroundTask.registerTaskAsync(ANI_UPLOAD_TASK, { minimumInterval: 15 });
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(ANI_UPLOAD_TASK);
    }
  } catch {
    // Background work unavailable (e.g. restricted by the OS): foreground uploads still run.
  }
}

/** Pro ended → pause the listener; Pro back → resume what the lapse paused. */
export function reconcileEntitlement(): boolean {
  if (!isNiSupported()) return false;
  const pro = isNiEntitled();
  if (pro === null) return false;
  const enabled = niCall(false, (ni) => ni.getState().enabled);
  if (!pro && enabled) {
    niCall(undefined, (ni) => {
      ni.setEnabled(false);
    });
    setPausedByLapse(true);
    return true;
  }
  if (pro && pausedByLapse()) {
    niCall(undefined, (ni) => {
      ni.setEnabled(true);
    });
    setPausedByLapse(false);
    return true;
  }
  return false;
}

export async function onAniForeground(): Promise<void> {
  if (!isNiSupported()) return;
  const changed = reconcileEntitlement();
  if (changed || reportPending()) await reportAniState();
  await flushAniSignals();
}

registerLogoutCleanup(LOGOUT_HOOKS.niBuffer, async () => {
  niCall(undefined, (ni) => {
    ni.reset();
  });
  await syncBackgroundUpload(false);
});

if (Platform.OS === 'android') {
  TaskManager.defineTask(ANI_UPLOAD_TASK, async () => {
    try {
      await openEncryptedStorage();
      const result = await flushAniSignals();
      return result === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

let bound = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Binds the foreground and new-signal triggers once (Android with the module only). */
export function bindAniLifecycle(): void {
  if (bound || !isNiSupported()) return;
  bound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void onAniForeground();
  });
  niModule()?.addListener('onSignalsChanged', () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (AppState.currentState === 'active') void flushAniSignals();
    }, SIGNAL_FLUSH_DELAY_MS);
  });
}
