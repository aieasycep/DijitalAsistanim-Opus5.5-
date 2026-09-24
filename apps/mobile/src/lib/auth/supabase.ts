/**
 * The app's Supabase client (ADR-06): publishable key, PKCE, session in LargeSecureStore, no URL
 * session detection. Auto refresh runs only while the app is in the foreground (AppState).
 * PostgREST calls are typed by the generated `Database` (`@da/api-client`, T-2.25).
 */
import { createSupabaseClient, type Database } from '@da/api-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { getClientEnv } from '../env';
import { largeSecureStore } from './large-secure-store';

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | undefined;

export function getSupabase(): AppSupabaseClient {
  if (client === undefined) {
    const env = getClientEnv();
    client = createSupabaseClient<Database>({
      url: env.EXPO_PUBLIC_SUPABASE_URL,
      publishableKey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      storage: largeSecureStore,
    });
  }
  return client;
}

/** Starts token auto-refresh in the foreground and stops it in the background. */
export function bindAutoRefresh(supabase: AppSupabaseClient = getSupabase()): () => void {
  const apply = (state: AppStateStatus) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  apply(AppState.currentState);
  const subscription = AppState.addEventListener('change', apply);
  return () => {
    subscription.remove();
  };
}

/** The current access token (refreshed by supabase-js when needed), or null when signed out. */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Forces one refresh (API client retry after `401 AUTH_REQUIRED`). */
export async function refreshAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabase().auth.refreshSession();
  if (error !== null) return null;
  return data.session?.access_token ?? null;
}

/** Test seam. */
export function setSupabaseForTests(next: AppSupabaseClient | undefined): void {
  client = next;
}
