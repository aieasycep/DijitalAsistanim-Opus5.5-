/**
 * App bootstrap (M-GL-01/02, API-BOOT-01): the Edge `api` client of this app and the
 * `GET /me/bootstrap` query every guard reads. The client sends the bearer token from the
 * Supabase session (one refresh-and-retry on 401), `X-DA-Client`, `X-DA-Installation-Id`,
 * `Accept-Language`, and blocks calls with `OFFLINE_BLOCKED` while TanStack's `onlineManager`
 * reports offline. Cross-cutting errors are handled once here:
 * - `426 CLIENT_UPGRADE_REQUIRED` → `/update-required` (M-GL-12 entry point);
 * - `ACCOUNT_DISABLED` / `ACCOUNT_DELETION_PENDING` → bootstrap refetch (the entry resolver shows
 *   the account state);
 * - `AUTH_REQUIRED` after the refresh retry → local sign-out (API_CONTRACTS §2.6).
 */
import { apiBaseUrl, createApiClient, qk, type ApiClient, type ApiError } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { currentAccessToken, getSupabase, refreshAccessToken } from './auth/supabase';
import { installationId } from './auth/first-run-purge';
import { apiLocale, clientHeader } from './device';
import { getClientEnv } from './env';
import { getQueryClient } from './query/client';
import { isOffline } from './query/online-manager';
import { UPDATE_REQUIRED_ROUTE, type BootstrapState } from './router-guards';
import { applyBootstrapPreferences } from './ui-prefs';

/** Reacts to errors every screen would otherwise have to handle. */
export function handleGlobalApiError(error: ApiError): void {
  switch (error.code) {
    case 'CLIENT_UPGRADE_REQUIRED':
      void getQueryClient().invalidateQueries({ queryKey: qk.me.bootstrap() });
      router.replace(UPDATE_REQUIRED_ROUTE);
      return;
    case 'ACCOUNT_DISABLED':
    case 'ACCOUNT_DELETION_PENDING':
      void getQueryClient().invalidateQueries({ queryKey: qk.me.bootstrap() });
      return;
    case 'AUTH_REQUIRED':
      if (error.kind === 'server' || error.kind === 'http') {
        void getSupabase().auth.signOut({ scope: 'local' });
      }
      return;
    default:
      return;
  }
}

let client: ApiClient | undefined;

export function getApiClient(): ApiClient {
  if (client === undefined) {
    const env = getClientEnv();
    client = createApiClient({
      baseUrl: apiBaseUrl(env.EXPO_PUBLIC_SUPABASE_URL),
      publishableKey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      getAccessToken: currentAccessToken,
      refreshAccessToken,
      clientHeader: clientHeader(),
      getInstallationId: installationId,
      getLocale: apiLocale,
      isOffline,
      generateId: Crypto.randomUUID,
      // RN's global fetch cannot stream a response body; expo/fetch can (API-AST-02).
      streamFetch: (url, init) => expoFetch(url, init),
      onError: handleGlobalApiError,
    });
  }
  return client;
}

export function setApiClientForTests(next: ApiClient | undefined): void {
  client = next;
}

/**
 * `GET /me/bootstrap` while signed in (persisted, 5 min stale, 3 retries). Server preferences
 * (theme, language, time zone, motion, haptics) are adopted as they arrive.
 */
export function useAppBootstrap(signedIn: boolean): BootstrapState & {
  readonly refetch: () => void;
  readonly isFetching: boolean;
} {
  const query = useBootstrap({ enabled: signedIn });
  const data = signedIn ? query.data : undefined;
  useEffect(() => {
    if (data !== undefined) applyBootstrapPreferences(data);
  }, [data]);
  return {
    status: data !== undefined ? 'success' : query.status === 'error' ? 'error' : 'pending',
    data,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** Whether a feature is reported unavailable by the server (`service_status`, M§90). */
export function unavailableReason(
  data: BootstrapData | undefined,
  feature: string,
): 'external_credential_required' | 'feature_disabled' | 'provider_outage' | null {
  return (
    data?.service_status.unavailable_features.find((f) => f.feature === feature)?.reason ?? null
  );
}

/** Accounts that granted a capability (calendar on Plan, mail on Today and Flow). */
export function hasCapability(data: BootstrapData | undefined, capability: string): boolean {
  return (data?.accounts ?? []).some((a) =>
    (a.capabilities_granted as readonly string[]).includes(capability),
  );
}
