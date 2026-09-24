/**
 * Full-app test harness: the real `app/` routes and providers, with a scripted Supabase auth
 * client (session, state events), the real `@da/api-client` over a recorded fetch, a fresh
 * QueryClient, and the native doubles of `test/setup/native-mocks.ts`.
 */
import { createApiClient, type ApiClient } from '@da/api-client';
import { jest } from '@jest/globals';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';
import { renderRouter } from 'expo-router/testing-library';

import { prepareSecureStorage } from '../../src/lib/auth/first-run-purge';
import { setApiClientForTests } from '../../src/lib/bootstrap';
import { setSupabaseForTests, type AppSupabaseClient } from '../../src/lib/auth/supabase';
import { resetPendingLinksForTests } from '../../src/lib/deeplinks';
import { resetAnalyticsForTests } from '../../src/lib/events';
import { createAppQueryClient, setQueryClientForTests } from '../../src/lib/query/client';
import { setGuardSnapshot } from '../../src/lib/router-guards';
import { encryptedStorage, isEncryptedStorageOpen } from '../../src/lib/storage';
import { resetUiPrefsForTests } from '../../src/lib/ui-prefs';
import { resetSheetsForTests } from '../../src/providers/SheetHost';
import { fakePostgrest, type PostgrestFake } from './postgrest';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

/** A test double's mock with any implementation (the scripted auth calls). */
export type LooseMock = jest.Mock<(...args: never[]) => unknown>;

export type FakeAuth = Record<
  | 'getSession'
  | 'onAuthStateChange'
  | 'startAutoRefresh'
  | 'stopAutoRefresh'
  | 'refreshSession'
  | 'signOut'
  | 'signInWithIdToken'
  | 'signInWithOAuth'
  | 'exchangeCodeForSession'
  | 'signInWithOtp'
  | 'verifyOtp'
  | 'updateUser',
  LooseMock
>;

export interface FakeSupabase {
  readonly client: AppSupabaseClient;
  readonly auth: FakeAuth;
  /** PostgREST double (`rpc`, `from`). */
  readonly db: PostgrestFake;
  /** Changes the session and emits the matching auth event. */
  setSession(next: Session | null): void;
}

export function fakeSupabase(initial: Session | null = null): FakeSupabase {
  let current = initial;
  const listeners = new Set<Listener>();
  const emit = (event: AuthChangeEvent) => {
    for (const listener of listeners) listener(event, current);
  };
  const auth: FakeAuth = {
    getSession: jest.fn(() => Promise.resolve({ data: { session: current }, error: null })),
    onAuthStateChange: jest.fn((listener: Listener) => {
      listeners.add(listener);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(listener);
            },
          },
        },
      };
    }),
    startAutoRefresh: jest.fn(() => Promise.resolve()),
    stopAutoRefresh: jest.fn(() => Promise.resolve()),
    refreshSession: jest.fn(() =>
      Promise.resolve({ data: { session: current, user: current?.user ?? null }, error: null }),
    ),
    signOut: jest.fn(() => {
      current = null;
      emit('SIGNED_OUT');
      return Promise.resolve({ error: null });
    }),
    signInWithIdToken: jest.fn(),
    signInWithOAuth: jest.fn(),
    exchangeCodeForSession: jest.fn(),
    signInWithOtp: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    verifyOtp: jest.fn(),
    updateUser: jest.fn(() => Promise.resolve({ data: {}, error: null })),
  };
  const db = fakePostgrest();
  return {
    client: { auth, rpc: db.rpc, from: db.from } as unknown as AppSupabaseClient,
    auth,
    db,
    setSession(next) {
      current = next;
      emit(next === null ? 'SIGNED_OUT' : 'SIGNED_IN');
    },
  };
}

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export type Responder = (call: RecordedCall) => Response | Promise<Response>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Installs the real API client over a fetch that answers by `METHOD /path`. */
export function installApi(routes: Readonly<Record<string, Responder>>): {
  readonly client: ApiClient;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client = createApiClient({
    baseUrl: 'https://project-ref.supabase.test/functions/v1/api',
    publishableKey: 'sb_publishable_jest0000',
    getAccessToken: () => 'header.payload.signature',
    clientHeader: 'ios/1.0.0 (42)',
    getInstallationId: () => '00000000-0000-4000-8000-000000000099',
    getLocale: () => 'tr-TR',
    isOffline: () => !onlineManager.isOnline(),
    fetch: (url, init) => {
      const path = new URL(url).pathname.replace('/functions/v1/api', '');
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      );
      const call: RecordedCall = {
        url,
        method: init.method ?? 'GET',
        headers,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      const key = `${call.method} ${path}`;
      const responder = routes[key];
      if (responder === undefined) return Promise.resolve(json(404, { error: 'unrouted' }));
      return Promise.resolve(responder(call));
    },
  });
  setApiClientForTests(client);
  return { client, calls };
}

/**
 * Fresh query client, sheets, prefs, analytics and caches for one test. The device's first-run
 * purge (which signs out locally) has already happened, so a test's scripted session survives.
 */
export async function resetAppState(): Promise<void> {
  await prepareSecureStorage({ signOutLocal: () => Promise.resolve() });
  setQueryClientForTests(createAppQueryClient({ gcTime: Infinity }));
  resetSheetsForTests();
  resetUiPrefsForTests();
  resetAnalyticsForTests();
  resetPendingLinksForTests();
  setGuardSnapshot({ auth: 'loading', signedOut: false, onboarding: false, app: false });
  onlineManager.setOnline(true);
  if (isEncryptedStorageOpen()) {
    encryptedStorage().cache.clearAll();
    encryptedStorage().prefs.clearAll();
  }
}

export function installFakeSupabase(initial: Session | null): FakeSupabase {
  const fake = fakeSupabase(initial);
  setSupabaseForTests(fake.client);
  return fake;
}

/**
 * Renders the real app directory at `initialUrl`. RNTL 14 renders asynchronously while
 * `renderRouter` is typed as synchronous (its result is also a thenable), so the render is adopted
 * here and the router helpers are returned wrapped — returning the thenable from an async function
 * would unwrap it and lose `getPathname()`.
 */
export async function renderApp(initialUrl = '/') {
  const router = renderRouter('./app', { initialUrl });
  await Promise.resolve(router);
  return { router };
}
