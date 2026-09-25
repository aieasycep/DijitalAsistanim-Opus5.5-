/**
 * `da-background-refresh` (SCREEN_AND_FLOW_MAP §11.4): one OS background task
 * (`expo-background-task`, at least every 30 min, best effort — the OS decides when it runs) that
 * runs the steps features register here, in registration order. The widget snapshot (T-8.25) is the
 * first step; other background work can register its own without a second task. A failing step
 * never stops the next one.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_REFRESH_TASK = 'da-background-refresh';
export const BACKGROUND_REFRESH_MINUTES = 30;

type Step = () => Promise<unknown>;
const steps = new Map<string, Step>();

/** Adds a step to the background task; returns the unregister function. */
export function registerBackgroundRefreshStep(name: string, step: Step): () => void {
  steps.set(name, step);
  return () => {
    steps.delete(name);
  };
}

/** Runs every step; false when any of them threw. */
export async function runBackgroundRefresh(): Promise<boolean> {
  let succeeded = true;
  for (const step of [...steps.values()]) {
    try {
      await step();
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}

TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () =>
  (await runBackgroundRefresh())
    ? BackgroundTask.BackgroundTaskResult.Success
    : BackgroundTask.BackgroundTaskResult.Failed,
);

/** Registers the task once where the OS allows background work (signed-in sessions only). */
export async function scheduleBackgroundRefresh(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK)) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
      minimumInterval: BACKGROUND_REFRESH_MINUTES,
    });
  } catch {
    // Best effort: without background execution the foreground triggers still refresh.
  }
}
