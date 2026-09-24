/**
 * Logout (SECURITY_AND_PRIVACY_PLAN CTL-3.13, INTEGRATION_PLAN §8.6, ADR-06). Every step is
 * try/catch'd so the local wipe always completes, even offline:
 *   1. `POST /devices/unregister {installation_id, reason}` (3 s, best effort);
 *   2. `before_sign_out` hooks — RevenueCat `Purchases.logOut()` (T-8.22);
 *   3. `supabase.auth.signOut({scope})`: `local` for "Çıkış Yap", `global` for "Tüm cihazlardan
 *      çıkış" (auth-js removes the local session even when the call fails);
 *   4. `queryClient.clear()`, `da-cache` and `da-session` wiped;
 *   5. the SecureStore keys deleted and replaced (every store re-encrypted, `da.oauth.pending` gone);
 *   6–8. `after_wipe` hooks — widget snapshot clear + reload (T-8.25), share staging and briefing
 *      audio files (T-8.17/T-8.09), the Android NI signal buffer (T-8.26);
 *   9. push token invalidation and scheduled local notifications cancelled;
 *   10. the auth state change routes to sign-in.
 */
import type { ApiClient } from '@da/api-client';
import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';

import { getApiClient } from '../bootstrap';
import { track } from '../events';
import { getQueryClient } from '../query/client';
import { isOffline } from '../query/online-manager';
import { wipeAndRekeyStorage } from '../storage';
import { installationId } from './first-run-purge';
import { getSupabase, type AppSupabaseClient } from './supabase';

export type LogoutScope = 'local' | 'global';
export type LogoutHookPhase = 'before_sign_out' | 'after_wipe';
export type LogoutHook = () => Promise<void> | void;

/** Names of the cleanup hooks later features register. */
export const LOGOUT_HOOKS = {
  revenueCat: 'revenuecat.log_out',
  widgetSnapshot: 'widgets.clear_snapshot',
  shareStaging: 'share.clear_staging',
  audioCache: 'audio.clear_cache',
  niBuffer: 'android_ni.clear_buffer',
} as const;

const hooks = new Map<string, { readonly phase: LogoutHookPhase; readonly run: LogoutHook }>();

/** Registers a cleanup step (RevenueCat, widgets, NI buffer, …); returns the unregister function. */
export function registerLogoutCleanup(
  name: string,
  run: LogoutHook,
  phase: LogoutHookPhase = 'after_wipe',
): () => void {
  hooks.set(name, { phase, run });
  return () => {
    hooks.delete(name);
  };
}

export interface LogoutDeps {
  readonly api?: ApiClient;
  readonly supabase?: AppSupabaseClient;
  readonly queryClient?: QueryClient;
  readonly installationId?: () => string | null;
  readonly wipeStorage?: () => Promise<void>;
  readonly unregisterPush?: () => Promise<unknown>;
  readonly cancelLocalNotifications?: () => Promise<unknown>;
  readonly isOffline?: () => boolean;
}

export interface LogoutOptions {
  readonly scope?: LogoutScope;
  readonly reason?: 'logout' | 'account_switch';
  readonly context?: 'onboarding' | 'settings';
}

export interface LogoutReport {
  readonly scope: LogoutScope;
  /** Steps that threw; the wipe still completed. */
  readonly failedSteps: readonly string[];
}

export async function logout(
  options: LogoutOptions = {},
  deps: LogoutDeps = {},
): Promise<LogoutReport> {
  const scope = options.scope ?? 'local';
  const failedSteps: string[] = [];
  const offline = (deps.isOffline ?? isOffline)();
  const step = async (name: string, run: () => unknown) => {
    try {
      await run();
    } catch {
      failedSteps.push(name);
    }
  };
  const runHooks = async (phase: LogoutHookPhase) => {
    for (const [name, hook] of [...hooks]) {
      if (hook.phase === phase) await step(name, hook.run);
    }
  };

  const install = (deps.installationId ?? installationId)();
  await step('devices_unregister', async () => {
    if (install === null) throw new Error('no installation id');
    await (deps.api ?? getApiClient()).call(
      'POST /devices/unregister',
      { body: { installation_id: install, reason: options.reason ?? 'logout' } },
      { timeoutMs: 3_000 },
    );
  });
  await runHooks('before_sign_out');
  await step('sign_out', async () => {
    const { error } = await (deps.supabase ?? getSupabase()).auth.signOut({ scope });
    if (error !== null) throw error;
  });
  await step('query_cache', () => {
    (deps.queryClient ?? getQueryClient()).clear();
  });
  await step('storage', deps.wipeStorage ?? wipeAndRekeyStorage);
  await runHooks('after_wipe');
  await step('push_token', deps.unregisterPush ?? Notifications.unregisterForNotificationsAsync);
  await step(
    'local_notifications',
    deps.cancelLocalNotifications ?? Notifications.cancelAllScheduledNotificationsAsync,
  );

  track('sign_out', {
    context: options.context ?? 'settings',
    scope: scope === 'global' ? 'global' : 'this',
    offline,
  });
  return { scope, failedSteps };
}
