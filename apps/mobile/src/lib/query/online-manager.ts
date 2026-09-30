/**
 * Connectivity and focus for TanStack Query (M-GL-01 "Wires onlineManager.setEventListener to
 * NetInfo and focusManager to AppState"). Offline = NetInfo reports no connection; an unknown
 * state (`null`) counts as online so a cold start never blocks. `isOffline()` is the API client's
 * `OFFLINE_BLOCKED` hook point.
 */
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export function bindOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
}

export function bindFocusManager(): () => void {
  const subscription = AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
  return () => {
    subscription.remove();
  };
}

export function isOffline(): boolean {
  return !onlineManager.isOnline();
}

function subscribe(listener: () => void): () => void {
  return onlineManager.subscribe(listener);
}

function isOnline(): boolean {
  return onlineManager.isOnline();
}

/** Re-renders on connectivity changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}
