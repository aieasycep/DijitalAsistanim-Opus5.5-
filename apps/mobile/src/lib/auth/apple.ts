/**
 * Sign in with Apple (ADR-06, INTEGRATION_PLAN §6.2, M-ON-05):
 * - iOS, native: rawNonce = hex of 32 random bytes; Apple receives `sha256(rawNonce)` and Supabase
 *   the raw nonce (`signInWithIdToken({provider:'apple', token, nonce})`), which binds the identity
 *   token to this request. The full name arrives only on the first authorization and is saved to
 *   the user metadata. The single-use `authorizationCode` (5 min) goes to `POST
 *   /auth/apple/exchange`, non-blocking, retried once; a failure sets `needs_apple_code_exchange`
 *   so the next Apple sign-in (a fresh code) retries it, and a missing server key
 *   (`EXTERNAL_CREDENTIAL_REQUIRED`) is ignored silently (API-DEV-03).
 * - Android: Apple through web OAuth (`browser-oauth.ts`).
 */
import type { ApiClient } from '@da/api-client';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { getApiClient } from '../bootstrap';
import { encryptedStorage, isEncryptedStorageOpen } from '../storage';
import { signInWithBrowserOAuth, type BrowserOAuthDeps } from './browser-oauth';
import { authFailureOf, failed, nativeErrorCode, succeeded, type AuthResult } from './result';
import { getSupabase, type AppSupabaseClient } from './supabase';

export const NEEDS_APPLE_EXCHANGE_KEY = 'auth.needs_apple_code_exchange';

export interface AppleNonce {
  /** Sent to Supabase. */
  readonly raw: string;
  /** SHA-256 hex of `raw`, sent to Apple. */
  readonly hashed: string;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createAppleNonce(): Promise<AppleNonce> {
  const raw = hex(Crypto.getRandomBytes(32));
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

/** The `sub` claim of a JWT (no verification: Supabase verifies the token). */
export function jwtSubject(token: string): string | null {
  const payload = token.split('.')[1];
  if (payload === undefined) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = JSON.parse(globalThis.atob(padded)) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

function markExchangeNeeded(needed: boolean): void {
  if (!isEncryptedStorageOpen()) return;
  if (needed) encryptedStorage().prefs.set(NEEDS_APPLE_EXCHANGE_KEY, true);
  else encryptedStorage().prefs.remove(NEEDS_APPLE_EXCHANGE_KEY);
}

/** `POST /auth/apple/exchange`, one retry with the same idempotency key. */
export async function exchangeAppleCode(
  authorizationCode: string,
  identityTokenSub: string,
  api: ApiClient = getApiClient(),
): Promise<boolean> {
  const idempotencyKey = Crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await api.call(
        'POST /auth/apple/exchange',
        { body: { authorization_code: authorizationCode, identity_token_sub: identityTokenSub } },
        { idempotencyKey },
      );
      markExchangeNeeded(false);
      return true;
    } catch (error) {
      const code = nativeErrorCode(error);
      if (code === 'EXTERNAL_CREDENTIAL_REQUIRED') return false;
      const retryable =
        typeof error === 'object' &&
        error !== null &&
        'retryable' in error &&
        error.retryable === true;
      if (!retryable || attempt === 1) {
        markExchangeNeeded(true);
        return false;
      }
    }
  }
  return false;
}

export interface AppleSignInDeps {
  readonly supabase?: AppSupabaseClient;
  readonly api?: ApiClient;
  readonly signIn?: typeof AppleAuthentication.signInAsync;
}

export async function signInWithAppleNative(deps: AppleSignInDeps = {}): Promise<AuthResult> {
  const supabase = deps.supabase ?? getSupabase();
  const nonce = await createAppleNonce();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await (deps.signIn ?? AppleAuthentication.signInAsync)({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonce.hashed,
    });
  } catch (error) {
    return failed(nativeErrorCode(error) === 'ERR_REQUEST_CANCELED' ? 'cancelled' : 'provider');
  }
  const identityToken = credential.identityToken;
  if (identityToken === null) return failed('provider');
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: nonce.raw,
    });
    if (error !== null) return failed(authFailureOf(error));
    const fullName =
      credential.fullName === null ? '' : AppleAuthentication.formatFullName(credential.fullName);
    if (fullName.trim() !== '') {
      void supabase.auth
        .updateUser({ data: { full_name: fullName.trim() } })
        .catch(() => undefined);
    }
    const sub = jwtSubject(identityToken);
    if (credential.authorizationCode !== null && sub !== null) {
      void exchangeAppleCode(credential.authorizationCode, sub, deps.api);
    }
    return succeeded(data.user);
  } catch (error) {
    return failed(authFailureOf(error));
  }
}

/** Android: Apple through the Supabase web flow (Services ID; external credential). */
export function signInWithAppleWeb(deps: BrowserOAuthDeps = {}): Promise<AuthResult> {
  return signInWithBrowserOAuth('apple', deps);
}
