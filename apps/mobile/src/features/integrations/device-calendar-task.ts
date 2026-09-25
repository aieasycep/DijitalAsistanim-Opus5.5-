/**
 * Background device-calendar snapshots (T-8.07, API-INT-06 "expo-background-task tick (best
 * effort)"): while a device calendar (Apple / Android) is connected, the `da-device-calendar-upload`
 * task (≥ 15 min, scheduled by the OS) re-uploads the selected calendars while the app is closed.
 * It is registered with the connection and removed at sign-out; the foreground and reconnect
 * uploads in `useDeviceCalendarSync` keep working when the OS restricts background work. Imported
 * by the root layout, because a task must be defined when the bundle starts.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../lib/auth/logout';
import { openEncryptedStorage } from '../../lib/storage';
import { uploadDeviceSnapshot } from './device-calendar';

export const DEVICE_CALENDAR_TASK = 'da-device-calendar-upload';
const MINIMUM_INTERVAL_MIN = 15;

/** The task body: opens the encrypted stores (headless launch) and uploads once. */
export async function runDeviceCalendarTask(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    await openEncryptedStorage();
    await uploadDeviceSnapshot();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

/** Registers or removes the background upload with the device-calendar connection. */
export async function syncDeviceCalendarTask(connected: boolean): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(DEVICE_CALENDAR_TASK);
    if (connected && !registered) {
      await BackgroundTask.registerTaskAsync(DEVICE_CALENDAR_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MIN,
      });
    } else if (!connected && registered) {
      await BackgroundTask.unregisterTaskAsync(DEVICE_CALENDAR_TASK);
    }
  } catch {
    // Background work unavailable (restricted by the OS or a build without it): foreground only.
  }
}

try {
  TaskManager.defineTask(DEVICE_CALENDAR_TASK, runDeviceCalendarTask);
} catch {
  // Defining fails only where the task manager does not exist; the foreground path still runs.
}

registerLogoutCleanup(LOGOUT_HOOKS.deviceCalendarTask, () => syncDeviceCalendarTask(false));
