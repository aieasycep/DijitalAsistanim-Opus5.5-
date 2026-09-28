/**
 * `da-background-notification` (KNOWN_PLATFORM_LIMITATIONS KPL-11, KPL-12): the handler of the
 * data-only `device_refresh` push the server sends before a morning or evening briefing when this
 * installation's device calendar has not synced for 30 minutes. The push shows nothing; the task
 * uploads the device-calendar snapshot (the same `POST /integrations/device-calendar/snapshot` as
 * the foreground) and runs the `da-background-refresh` steps (the widget snapshot), so the
 * briefing the server generates a few minutes later sees the current schedule.
 *
 * The task is registered with `expo-notifications` while a device calendar is connected
 * (`device-calendar-task.ts`) and removed with it. The OS decides whether a background push is
 * delivered at all (iOS throttles them and drops them after a force-quit; Android defers them in
 * Doze), so the briefing never depends on it: it records how fresh the device data was and the app
 * shows the stale note or the change banner (`features/briefing/device-freshness.ts`). The same
 * handler runs when the push arrives while the app is open (`lib/notifications/handlers.ts`); one
 * refresh runs at a time.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { runBackgroundRefresh } from '../../lib/background-refresh';
import { openEncryptedStorage } from '../../lib/storage';
import { uploadDeviceSnapshot } from './device-calendar';

export const BACKGROUND_NOTIFICATION_TASK = 'da-background-notification';
export const DEVICE_REFRESH_PUSH = 'device_refresh';

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * The `type` of a push, wherever the platform put the `{type, entity_id, deeplink}` object: the
 * notification content (foreground), `dataString` (Android task payload), `body` (the Expo push
 * service's APNs / FCM envelope) or the top level.
 */
export function pushTypeOf(payload: unknown): string | null {
  const root = record(payload);
  if (root === null) return null;
  const data = record(root.data) ?? root;
  for (const candidate of [data, record(data.dataString), record(data.body)]) {
    const type = candidate?.type;
    if (typeof type === 'string') return type;
    const nested = record(candidate?.body)?.type;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

export type DeviceRefreshResult = 'uploaded' | 'nothing' | 'failed';

let running: Promise<DeviceRefreshResult> | null = null;

/** Uploads the device calendar and refreshes the widgets (one run at a time). */
export function refreshForPush(): Promise<DeviceRefreshResult> {
  running ??= (async (): Promise<DeviceRefreshResult> => {
    try {
      await openEncryptedStorage();
      const account = await uploadDeviceSnapshot();
      await runBackgroundRefresh();
      return account === null ? 'nothing' : 'uploaded';
    } catch {
      return 'failed';
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function runBackgroundNotificationTask({
  data,
}: {
  readonly data: unknown;
}): Promise<Notifications.BackgroundNotificationTaskResult> {
  if (pushTypeOf(data) !== DEVICE_REFRESH_PUSH) {
    return Notifications.BackgroundNotificationTaskResult.NoData;
  }
  const result = await refreshForPush();
  if (result === 'uploaded') return Notifications.BackgroundNotificationTaskResult.NewData;
  return result === 'failed'
    ? Notifications.BackgroundNotificationTaskResult.Failed
    : Notifications.BackgroundNotificationTaskResult.NoData;
}

/** Registers or removes the background notification task with the device-calendar connection. */
export async function syncBackgroundNotificationTask(connected: boolean): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK);
    if (connected && !registered) {
      await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    } else if (!connected && registered) {
      await Notifications.unregisterTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    }
  } catch {
    // Background notifications unavailable in this build: the foreground uploads still run.
  }
}

try {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, runBackgroundNotificationTask);
} catch {
  // Defining fails only where the task manager does not exist; the foreground path still runs.
}
