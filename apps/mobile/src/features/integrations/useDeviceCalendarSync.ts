/**
 * Device-calendar snapshots on app foreground (T-8.07): while a device calendar is connected, the
 * selected calendars are re-uploaded when the app becomes active (at most every 15 minutes) and
 * when the connection returns, and the background task (`device-calendar-task.ts`) is registered
 * for uploads while the app is closed. Mounted by the Today tab root, which is alive whenever the
 * app is.
 */
import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { deviceProvider, uploadDeviceSnapshot } from './device-calendar';
import { syncDeviceCalendarTask } from './device-calendar-task';
import type { AccountRow } from './accounts';

const MIN_INTERVAL_MS = 15 * 60_000;
let lastUpload = 0;

export function resetDeviceSyncForTests(): void {
  lastUpload = 0;
}

function maybeUpload(): void {
  if (!onlineManager.isOnline() || Date.now() - lastUpload < MIN_INTERVAL_MS) return;
  lastUpload = Date.now();
  void uploadDeviceSnapshot().catch(() => {
    lastUpload = 0;
  });
}

export function useDeviceCalendarSync(accounts: readonly AccountRow[] | undefined): void {
  const connected = (accounts ?? []).some((a) => a.provider === deviceProvider());
  useEffect(() => {
    if (accounts === undefined) return;
    void syncDeviceCalendarTask(connected);
  }, [accounts, connected]);
  useEffect(() => {
    if (!connected) return;
    maybeUpload();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeUpload();
    });
    const online = onlineManager.subscribe((isOnline) => {
      if (isOnline) maybeUpload();
    });
    return () => {
      appState.remove();
      online();
    };
  }, [connected]);
}
