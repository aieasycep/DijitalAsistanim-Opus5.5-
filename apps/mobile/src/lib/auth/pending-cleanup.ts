/**
 * Offline "Çıkış Yap" (M-SET-02 Offline, Part 4 §14 "Local-only, allowed"): the local wipe runs at
 * once, but the server session cannot be revoked and the device's pushes cannot be stopped without
 * a connection. So before the local sign-out the refresh token is kept encrypted in SecureStore as
 * `pending_session_cleanup`; the next time the app is online — even signed out — it exchanges the
 * token for a short-lived session (never adopted by the app), calls `POST /devices/unregister`,
 * revokes that session online (`/auth/v1/logout?scope=local`) and deletes the key. A token the
 * server no longer accepts (already expired or revoked) leaves nothing to clean up.
 */
import { apiBaseUrl, createApiClient } from '@da/api-client';
import { onlineManager } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { clientHeader } from '../device';
import { getClientEnv } from '../env';
import { SECURE_STORE_OPTIONS } from '../storage';
import { installationId } from './first-run-purge';

export const PENDING_SESSION_CLEANUP_KEY = 'da.pending_session_cleanup';

export type CleanupResult = 'none' | 'done' | 'retry';

export interface CleanupDeps {
  readonly fetch?: typeof fetch;
  readonly installationId?: () => string | null;
}

/** Keeps the refresh token of a session signed out offline (called before the local sign-out). */
export async function storePendingSessionCleanup(refreshToken: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_SESSION_CLEANUP_KEY, refreshToken, SECURE_STORE_OPTIONS);
}

export async function hasPendingSessionCleanup(): Promise<boolean> {
  const token = await SecureStore.getItemAsync(PENDING_SESSION_CLEANUP_KEY, SECURE_STORE_OPTIONS);
  return token !== null && token !== '';
}

async function forget(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_SESSION_CLEANUP_KEY, SECURE_STORE_OPTIONS);
}

let running: Promise<CleanupResult> | null = null;

/** Finishes an offline sign-out once online; safe to call on every launch and reconnect. */
export function completePendingSessionCleanup(deps: CleanupDeps = {}): Promise<CleanupResult> {
  running ??= run(deps).finally(() => {
    running = null;
  });
  return running;
}

async function run(deps: CleanupDeps): Promise<CleanupResult> {
  const token = await SecureStore.getItemAsync(
    PENDING_SESSION_CLEANUP_KEY,
    SECURE_STORE_OPTIONS,
  ).catch(() => null);
  if (token === null || token === '') return 'none';
  const env = getClientEnv();
  const doFetch = deps.fetch ?? fetch;
  const auth = `${env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const apikey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let access: string;
  try {
    const response = await doFetch(`${auth}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // The token is no longer valid: the session is already gone server-side.
      await forget();
      return 'done';
    }
    if (!response.ok) return 'retry';
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== 'string') return 'retry';
    access = body.access_token;
  } catch {
    return 'retry';
  }
  const install = (deps.installationId ?? installationId)();
  if (install !== null) {
    const api = createApiClient({
      baseUrl: apiBaseUrl(env.EXPO_PUBLIC_SUPABASE_URL),
      publishableKey: apikey,
      getAccessToken: () => access,
      clientHeader: clientHeader(),
      getInstallationId: () => install,
      getLocale: () => 'tr-TR',
      generateId: Crypto.randomUUID,
      fetch: doFetch,
    });
    await api
      .call(
        'POST /devices/unregister',
        { body: { installation_id: install, reason: 'logout' } },
        { timeoutMs: 5_000 },
      )
      .catch(() => undefined);
  }
  try {
    const response = await doFetch(`${auth}/logout?scope=local`, {
      method: 'POST',
      headers: { apikey, authorization: `Bearer ${access}` },
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) return 'retry';
  } catch {
    return 'retry';
  }
  await forget();
  return 'done';
}

let bound = false;

/** Runs the cleanup at launch and on every reconnect (idempotent binding). */
export function bindPendingSessionCleanup(): void {
  if (bound) return;
  bound = true;
  const attempt = () => {
    if (onlineManager.isOnline()) void completePendingSessionCleanup().catch(() => undefined);
  };
  attempt();
  onlineManager.subscribe((online) => {
    if (online) attempt();
  });
}
