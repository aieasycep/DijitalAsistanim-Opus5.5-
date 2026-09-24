/**
 * Toast host (M-GL-05). The queue, motion, timing and announcements are the `@da/ui` toast system
 * mounted by `DaUiProvider`; this host adds what the app shell owns:
 * - `showToast()` for code outside React (API error hooks, logout, deep-link handling), bridged to
 *   the nearest `useToast()` controller while the host is mounted;
 * - the bottom offset: tab bar height + 14 while a tab screen shows the bar (`useTabBarToastOffset`),
 *   the safe-area default everywhere else.
 */
import { useToast, type ToastData } from '@da/ui';
import { useEffect, useSyncExternalStore } from 'react';

export type ToastInput = Omit<ToastData, 'id'> & { readonly id?: string };

type Show = (toast: ToastInput) => string;

let bridge: Show | null = null;
const pending: ToastInput[] = [];

/** Shows a toast from anywhere; queued until the host mounts. */
export function showToast(toast: ToastInput): void {
  if (bridge !== null) bridge(toast);
  else if (pending.length < 3) pending.push(toast);
}

/** Registers the `@da/ui` toast controller as the target of `showToast`. */
export function ToastHost(): null {
  const { show } = useToast();
  useEffect(() => {
    bridge = show;
    for (const toast of pending.splice(0)) show(toast);
    return () => {
      if (bridge === show) bridge = null;
    };
  }, [show]);
  return null;
}

/** Distance between the tab bar top and a toast (M-GL-05: tab bar height + 14). */
export const TOAST_TAB_BAR_GAP = 14;

let bottomOffset: number | undefined;
const listeners = new Set<() => void>();

function setBottomOffset(next: number | undefined): void {
  if (next === bottomOffset) return;
  bottomOffset = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getBottomOffset(): number | undefined {
  return bottomOffset;
}

/** The current toast bottom offset (`undefined` = the kit's safe-area default). */
export function useToastBottomOffset(): number | undefined {
  return useSyncExternalStore(subscribe, getBottomOffset, getBottomOffset);
}

/** Lifts toasts above the tab bar while the calling layout shows it. */
export function useTabBarToastOffset(tabBarHeight: number, visible: boolean): void {
  useEffect(() => {
    setBottomOffset(visible ? tabBarHeight + TOAST_TAB_BAR_GAP : undefined);
    return () => {
      setBottomOffset(undefined);
    };
  }, [tabBarHeight, visible]);
}
