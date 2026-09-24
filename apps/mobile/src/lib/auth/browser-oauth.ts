/**
 * Browser OAuth through Supabase (INTEGRATION_PLAN §8.3 and §6.2): Microsoft (`azure`) on both
 * platforms and Apple on Android use `signInWithOAuth({skipBrowserRedirect: true})` (PKCE; the
 * verifier lives in LargeSecureStore) → `WebBrowser.openAuthSessionAsync(url, redirectTo)` →
 * `exchangeCodeForSession(code)`. The redirect is `<scheme>://auth/callback`; when the auth session
 * is lost the app opens `app/auth/callback` with the code instead, and `exchangeAuthCode` makes
 * sure one code is exchanged once.
 */
import * as WebBrowser from 'expo-web-browser';

import { appLink } from '../env';
import { authFailureOf, failed, succeeded, type AuthResult } from './result';
import { getSupabase, type AppSupabaseClient } from './supabase';

export const AUTH_CALLBACK_PATH = 'auth/callback';

export type BrowserOAuthProvider = 'azure' | 'apple';

export interface BrowserSignInIntent {
  readonly method: 'microsoft' | 'apple';
  readonly mode: 'signup' | 'signin';
}

/** `WebBrowser.openAuthSessionAsync` as this flow uses it: `success` carries the redirect URL. */
export type OpenAuthSession = (
  url: string,
  redirectUrl: string,
) => Promise<{ readonly type: string; readonly url?: string }>;

export interface BrowserOAuthDeps {
  readonly supabase?: AppSupabaseClient;
  readonly openAuthSession?: OpenAuthSession;
  readonly redirectTo?: string;
  /** Remembered so `app/auth/callback` can finish a sign-in whose auth session was lost. */
  readonly intent?: BrowserSignInIntent;
}

let pendingIntent: BrowserSignInIntent | null = null;

/** The sign-in a browser flow started (consumed by the callback route). */
export function takeBrowserSignInIntent(): BrowserSignInIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

export interface AuthRedirect {
  readonly code: string | null;
  readonly error: string | null;
}

/** Reads `code` / `error` from the redirect URL (query first, then fragment). */
export function parseAuthRedirect(url: string): AuthRedirect {
  const read = (part: string) => new URLSearchParams(part);
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const query = q === -1 ? '' : url.slice(q + 1, h > q ? h : undefined);
  const fragment = h === -1 ? '' : url.slice(h + 1);
  const params = [read(query), read(fragment)];
  const get = (key: string) => params.map((p) => p.get(key)).find((v) => v !== null) ?? null;
  return { code: get('code'), error: get('error') };
}

const inflight = new Map<string, Promise<AuthResult>>();
const claimed = new Set<string>();

/**
 * The auth session and the callback route can both receive the same code (Android delivers the
 * redirect to both); the first to claim it runs the post-sign-in pipeline.
 */
export function claimCompletion(code: string): boolean {
  if (claimed.has(code)) return false;
  claimed.add(code);
  return true;
}

/** Whether this code is being exchanged right now (the callback route then waits). */
export function isExchangingCode(code: string): boolean {
  return inflight.has(code);
}

/** Exchanges a PKCE code once; concurrent callers share the same promise. */
export function exchangeAuthCode(
  code: string,
  supabase: AppSupabaseClient = getSupabase(),
): Promise<AuthResult> {
  const existing = inflight.get(code);
  if (existing !== undefined) return existing;
  const pending = (async (): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error !== null) return failed(authFailureOf(error));
      return succeeded(data.user);
    } catch (error) {
      return failed(authFailureOf(error));
    }
  })();
  inflight.set(code, pending);
  void pending.finally(() => inflight.delete(code));
  return pending;
}

export async function signInWithBrowserOAuth(
  provider: BrowserOAuthProvider,
  deps: BrowserOAuthDeps = {},
): Promise<AuthResult> {
  const supabase = deps.supabase ?? getSupabase();
  const redirectTo = deps.redirectTo ?? appLink(AUTH_CALLBACK_PATH);
  let url: string;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        // Microsoft needs the `email` scope (ADR-06, `xms_edov`).
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
    if (error !== null) return failed(authFailureOf(error));
    url = data.url;
  } catch (error) {
    return failed(authFailureOf(error));
  }
  pendingIntent = deps.intent ?? null;
  const result = await (deps.openAuthSession ?? WebBrowser.openAuthSessionAsync)(url, redirectTo);
  if (result.type !== 'success' || result.url === undefined) return failed('cancelled');
  pendingIntent = null;
  const redirect = parseAuthRedirect(result.url);
  if (redirect.code === null) {
    return failed(redirect.error === 'access_denied' ? 'cancelled' : 'provider');
  }
  const exchanged = await exchangeAuthCode(redirect.code, supabase);
  if (exchanged.ok && !claimCompletion(redirect.code)) {
    return { ...exchanged, completedElsewhere: true };
  }
  return exchanged;
}
