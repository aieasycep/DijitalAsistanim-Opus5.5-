/**
 * Root notification effects (T-8.24, M-GL-08): the tap and foreground listeners (bound once, from
 * the first render, so a cold-start tap is never missed — it is stored as the pending link while
 * the guards are still closed), and, while signed in to the app, the push registration sync and the
 * local reminder reconciliation on entry, on every foreground and when the notification detail
 * level or lock-screen privacy changes.
 */
import { useBootstrap } from '@da/api-client/react';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { bindNotificationHandlers } from '../../lib/notifications/handlers';
import { reconcileLocalReminders } from '../../lib/notifications/local-reminders';
import { bindPushTokenRefresh, syncPushRegistration } from '../../lib/notifications/register';
import { flushMutationQueue } from '../../lib/offline/mutations';

let unbindHandlers: (() => void) | null = null;

export function NotificationBridge({ signedIn }: { readonly signedIn: boolean }): null {
  const bootstrap = useBootstrap({ enabled: signedIn });
  const prefs = signedIn ? bootstrap.data?.notification_preferences : undefined;
  const level = prefs?.detail_level ?? null;
  const lockScreenPrivate = prefs?.lock_screen_private ?? null;

  useEffect(() => {
    unbindHandlers ??= bindNotificationHandlers();
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void syncPushRegistration();
    // Writes queued before the session was restored (a cold-start notification open).
    void flushMutationQueue();
    const unbindToken = bindPushTokenRefresh();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void syncPushRegistration();
      void reconcileLocalReminders();
    });
    return () => {
      unbindToken();
      foreground.remove();
    };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || level === null) return;
    void reconcileLocalReminders();
  }, [signedIn, level, lockScreenPrivate]);

  return null;
}

/** Test seam. */
export function resetNotificationBridgeForTests(): void {
  unbindHandlers?.();
  unbindHandlers = null;
}
