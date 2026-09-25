/**
 * Keeps the home-screen widgets current while signed in (T-8.25, SCREEN_AND_FLOW_MAP §11.4):
 * launch, every foreground, a push received in the foreground, a successful Today refetch,
 * count-changing mutations (approvals, insight status, reminders) and an entitlement change in the
 * bootstrap; it also schedules the `da-background-refresh` task. Sign-in refreshes through the
 * post-sign-in hook (forced). Renders nothing; sign-out clears the widgets through the logout hook.
 */
import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerPostSignInHook } from '../../lib/auth/post-sign-in';
import { scheduleBackgroundRefresh } from '../../lib/background-refresh';
import { cachedBootstrap } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { refreshWidgetSnapshot, reportWidgetInventory } from './snapshot';

/** Subscribes the refresh triggers; returns the unsubscribe function. */
export function bindWidgetRefresh(queryClient: QueryClient = getQueryClient()): () => void {
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void refreshWidgetSnapshot('foreground');
  });
  const push = Notifications.addNotificationReceivedListener(() => {
    void refreshWidgetSnapshot('push');
  });
  let entitled = cachedBootstrap()?.entitlement.is_active;
  const queries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const [area, detail] = event.query.queryKey as readonly unknown[];
    if (area === 'today') {
      void refreshWidgetSnapshot('foreground', { afterRefetch: true });
    } else if (area === 'me' && detail === 'bootstrap') {
      const active = cachedBootstrap()?.entitlement.is_active;
      if (entitled !== undefined && active !== undefined && active !== entitled) {
        void refreshWidgetSnapshot('settings', { force: true });
      }
      entitled = active;
    }
  });
  const mutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      void refreshWidgetSnapshot('approval');
    }
  });
  return () => {
    appState.remove();
    push.remove();
    queries();
    mutations();
  };
}

export function WidgetBridge({ signedIn }: { readonly signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;
    void refreshWidgetSnapshot('foreground');
    void reportWidgetInventory();
    void scheduleBackgroundRefresh();
    return bindWidgetRefresh();
  }, [signedIn]);
  return null;
}

registerPostSignInHook('widgets.refresh', async () => {
  await refreshWidgetSnapshot('login', { force: true });
});
