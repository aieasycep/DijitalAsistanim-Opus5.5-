/**
 * T-8.05 sign-in mechanics (ADR-06, INTEGRATION_PLAN §6.2 / §8.2–8.4): Apple nonce binding and
 * code exchange, Google configuration gate and error mapping, the Microsoft / Android-Apple PKCE
 * browser flow, e-mail OTP error classification, provider availability and the post-auth pipeline.
 */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import {
  createAppleNonce,
  exchangeAppleCode,
  jwtSubject,
  signInWithAppleNative,
} from '../src/lib/auth/apple';
import {
  claimCompletion,
  exchangeAuthCode,
  parseAuthRedirect,
  signInWithBrowserOAuth,
  takeBrowserSignInIntent,
} from '../src/lib/auth/browser-oauth';
import {
  isValidEmail,
  otpRequestFailureOf,
  otpVerifyFailureOf,
  requestEmailOtp,
  verifyEmailOtp,
  OTP_EXPIRY_MS,
} from '../src/lib/auth/email-otp';
import { googleClientConfig, resetGoogleForTests, signInWithGoogle } from '../src/lib/auth/google';
import { signInWithMicrosoft } from '../src/lib/auth/microsoft';
import {
  isFreshProfile,
  registerPostSignInHook,
  runPostSignIn,
  type PostSignInHook,
} from '../src/lib/auth/post-sign-in';
import { fetchProviderAvailability } from '../src/lib/auth/providers';
import { authFailureOf } from '../src/lib/auth/result';
import { prepareSecureStorage } from '../src/lib/auth/first-run-purge';
import { createAppQueryClient } from '../src/lib/query/client';
import { fakeSupabase, installApi, json } from './helpers/app';
import { bootstrap, ok, session, uuid } from './helpers/fixtures';

const googleSignIn = jest.mocked(GoogleSignin.signIn);
const appleSignIn = jest.mocked(AppleAuthentication.signInAsync);

/** An unsigned JWT with the given subject (Supabase verifies the real one). */
function jwt(sub: string): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`;
}

const user = { id: uuid(1), created_at: new Date().toISOString() };

beforeEach(async () => {
  jest.clearAllMocks();
  await prepareSecureStorage({ signOutLocal: () => Promise.resolve() });
});

describe('Apple (iOS native)', () => {
  it('sends sha256(rawNonce) to Apple and the raw nonce to Supabase', async () => {
    const nonce = await createAppleNonce();
    expect(nonce.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce.hashed).toBe(createHash('sha256').update(nonce.raw).digest('hex'));

    const fake = fakeSupabase();
    fake.auth.signInWithIdToken.mockImplementation(() =>
      Promise.resolve({ data: { user, session: session() }, error: null }),
    );
    const api = installApi({ 'POST /auth/apple/exchange': () => json(200, ok({ stored: true })) });
    appleSignIn.mockResolvedValue({
      identityToken: jwt('001234.apple.sub'),
      authorizationCode: 'c'.repeat(40),
      fullName: { givenName: 'Ahmet', familyName: 'Yılmaz' },
    } as never);

    const result = await signInWithAppleNative({ supabase: fake.client, api: api.client });

    expect(result).toEqual({ ok: true, userId: uuid(1), isNewUser: true });
    const appleNonce = (appleSignIn.mock.calls[0]?.[0] as { nonce: string }).nonce;
    const call = fake.auth.signInWithIdToken.mock.calls[0]?.[0] as unknown as {
      nonce: string;
      provider: string;
    };
    expect(call.provider).toBe('apple');
    expect(appleNonce).toBe(createHash('sha256').update(call.nonce).digest('hex'));
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Ahmet Yılmaz' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const exchange = api.calls.find((c) => c.url.endsWith('/auth/apple/exchange'));
    expect(exchange?.body).toEqual({
      authorization_code: 'c'.repeat(40),
      identity_token_sub: '001234.apple.sub',
    });
    expect(exchange?.headers['idempotency-key']).toBeDefined();
  });

  it('is silent on cancel and maps other failures', async () => {
    appleSignIn.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    expect(await signInWithAppleNative({ supabase: fakeSupabase().client })).toEqual({
      ok: false,
      code: 'cancelled',
    });
    appleSignIn.mockRejectedValueOnce(new Error('boom'));
    expect(await signInWithAppleNative({ supabase: fakeSupabase().client })).toEqual({
      ok: false,
      code: 'provider',
    });
  });

  it('retries the code exchange once and ignores a missing server key', async () => {
    let attempts = 0;
    const flaky = installApi({
      'POST /auth/apple/exchange': () => {
        attempts += 1;
        return attempts === 1
          ? json(504, {
              error: {
                code: 'UPSTREAM_TIMEOUT',
                message: 'x',
                message_key: 'errors.upstream_timeout',
                retryable: true,
                correlation_id: 'c-12345678',
              },
            })
          : json(200, ok({ stored: true }));
      },
    });
    expect(await exchangeAppleCode('c'.repeat(40), 'sub', flaky.client)).toBe(true);
    expect(attempts).toBe(2);
    const keys = flaky.calls.map((c) => c.headers['idempotency-key']);
    expect(keys[0]).toBe(keys[1]);

    const missing = installApi({
      'POST /auth/apple/exchange': () =>
        json(503, {
          error: {
            code: 'EXTERNAL_CREDENTIAL_REQUIRED',
            message: 'x',
            message_key: 'errors.external_credential_required',
            retryable: false,
            correlation_id: 'c-12345678',
          },
        }),
    });
    expect(await exchangeAppleCode('c'.repeat(40), 'sub', missing.client)).toBe(false);
    expect(missing.calls).toHaveLength(1);
  });

  it('reads the JWT subject', () => {
    expect(jwtSubject(jwt('abc'))).toBe('abc');
    expect(jwtSubject('not-a-jwt')).toBeNull();
  });
});

describe('Google', () => {
  beforeEach(() => {
    resetGoogleForTests();
  });

  it('is configured only with its client IDs (iOS also needs the iOS client ID)', () => {
    const web = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
    expect(googleClientConfig({}, 'android')).toBeNull();
    expect(googleClientConfig({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: web }, 'android')).toEqual({
      webClientId: web,
    });
    expect(googleClientConfig({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: web }, 'ios')).toBeNull();
  });

  it('reports not_configured without touching the SDK', async () => {
    expect(await signInWithGoogle({ config: null })).toEqual({ ok: false, code: 'not_configured' });
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
  });

  it('requests only openid/email/profile and signs in with the ID token', async () => {
    const fake = fakeSupabase();
    fake.auth.signInWithIdToken.mockImplementation(() =>
      Promise.resolve({ data: { user, session: session() }, error: null }),
    );
    googleSignIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-id-token' },
    } as never);
    const result = await signInWithGoogle({ supabase: fake.client, config: { webClientId: 'w' } });
    expect(result.ok).toBe(true);
    expect(GoogleSignin.configure).toHaveBeenCalledWith({ webClientId: 'w', scopes: [] });
    expect(fake.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
  });

  it('maps cancel, Play Services and missing tokens', async () => {
    const config = { webClientId: 'w' };
    googleSignIn.mockResolvedValueOnce({ type: 'cancelled', data: null } as never);
    expect(await signInWithGoogle({ config })).toEqual({ ok: false, code: 'cancelled' });
    googleSignIn.mockRejectedValueOnce({ code: 'PLAY_SERVICES_NOT_AVAILABLE' });
    expect(await signInWithGoogle({ config })).toEqual({ ok: false, code: 'play_services' });
    googleSignIn.mockResolvedValueOnce({ type: 'success', data: { idToken: null } } as never);
    expect(await signInWithGoogle({ config })).toEqual({ ok: false, code: 'provider' });
  });
});

describe('Microsoft and Android Apple (PKCE browser flow)', () => {
  it('opens the auth session with the email scope and exchanges the returned code once', async () => {
    const fake = fakeSupabase();
    fake.auth.signInWithOAuth.mockImplementation(() =>
      Promise.resolve({ data: { url: 'https://auth.example/authorize?x=1' }, error: null }),
    );
    fake.auth.exchangeCodeForSession.mockImplementation(() =>
      Promise.resolve({ data: { user, session: session() }, error: null }),
    );
    const openAuthSession = jest.fn(() =>
      Promise.resolve({
        type: 'success' as const,
        url: 'dijitalasistan-dev://auth/callback?code=pkce-1',
      }),
    );
    const result = await signInWithMicrosoft({
      supabase: fake.client,
      openAuthSession,
      redirectTo: 'dijitalasistan-dev://auth/callback',
      intent: { method: 'microsoft', mode: 'signin' },
    });
    expect(result).toMatchObject({ ok: true, userId: uuid(1) });
    expect(fake.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: {
        redirectTo: 'dijitalasistan-dev://auth/callback',
        skipBrowserRedirect: true,
        scopes: 'email',
      },
    });
    expect(openAuthSession).toHaveBeenCalledWith(
      'https://auth.example/authorize?x=1',
      'dijitalasistan-dev://auth/callback',
    );
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-1');
    // The completion was claimed by this flow; the callback route would not run it again.
    expect(claimCompletion('pkce-1')).toBe(false);
    expect(takeBrowserSignInIntent()).toBeNull();
  });

  it('treats a dismissed session as cancelled and keeps the intent for the callback route', async () => {
    const fake = fakeSupabase();
    fake.auth.signInWithOAuth.mockImplementation(() =>
      Promise.resolve({ data: { url: 'https://auth.example/a' }, error: null }),
    );
    const result = await signInWithBrowserOAuth('apple', {
      supabase: fake.client,
      openAuthSession: () => Promise.resolve({ type: 'dismiss' as const }),
      redirectTo: 'dijitalasistan://auth/callback',
      intent: { method: 'apple', mode: 'signup' },
    });
    expect(result).toEqual({ ok: false, code: 'cancelled' });
    expect(takeBrowserSignInIntent()).toEqual({ method: 'apple', mode: 'signup' });
  });

  it('shares one exchange per code', async () => {
    const fake = fakeSupabase();
    let resolve: (value: unknown) => void = () => undefined;
    fake.auth.exchangeCodeForSession.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const a = exchangeAuthCode('shared', fake.client);
    const b = exchangeAuthCode('shared', fake.client);
    resolve({ data: { user, session: session() }, error: null });
    expect(await a).toEqual(await b);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('reads code and error from the redirect', () => {
    expect(parseAuthRedirect('x://auth/callback?code=abc')).toEqual({ code: 'abc', error: null });
    expect(parseAuthRedirect('x://auth/callback#error=access_denied')).toEqual({
      code: null,
      error: 'access_denied',
    });
  });

  it('maps Supabase errors', () => {
    expect(authFailureOf(new AuthRetryableFetchError('offline', 0))).toBe('network');
    expect(
      authFailureOf(
        new AuthApiError('Unsupported provider: provider is not enabled', 400, 'validation_failed'),
      ),
    ).toBe('not_configured');
    expect(authFailureOf(new AuthApiError('Invalid token', 401, undefined))).toBe('provider');
  });
});

describe('e-mail one-time code', () => {
  it('validates addresses', () => {
    expect(isValidEmail(' Ahmet@Example.com ')).toBe(true);
    expect(isValidEmail('ahmet@')).toBe(false);
  });

  it('never creates users in sign-in mode and passes the locale', async () => {
    const fake = fakeSupabase();
    await requestEmailOtp({ email: 'A@B.co', mode: 'signin', locale: 'en' }, fake.client);
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      options: { shouldCreateUser: false, data: { locale: 'en' } },
    });
  });

  it('classifies request failures', () => {
    expect(
      otpRequestFailureOf(new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled')),
    ).toBe('no_account');
    expect(otpRequestFailureOf(new AuthApiError('rate', 429, 'over_email_send_rate_limit'))).toBe(
      'rate_limited',
    );
    expect(otpRequestFailureOf(new AuthRetryableFetchError('x', 0))).toBe('network');
  });

  it('tells a wrong code from an expired one by the time since sending', () => {
    const error = new AuthApiError('Token has expired or is invalid', 403, 'otp_expired');
    expect(otpVerifyFailureOf(error, 1_000, 1_000 + 30_000)).toBe('invalid');
    expect(otpVerifyFailureOf(error, 1_000, 1_000 + OTP_EXPIRY_MS)).toBe('expired');
  });

  it('verifies with type email', async () => {
    const fake = fakeSupabase();
    fake.auth.verifyOtp.mockImplementation(() =>
      Promise.resolve({ data: { user, session: session() }, error: null }),
    );
    const result = await verifyEmailOtp(
      { email: 'a@b.co', token: '123456', sentAt: Date.now() },
      fake.client,
    );
    expect(result.ok).toBe(true);
    expect(fake.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      token: '123456',
      type: 'email',
    });
  });
});

describe('provider availability (GoTrue settings)', () => {
  const env = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.test',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_jest0000',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: undefined,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: undefined,
  };

  it('reads the enabled providers with the publishable key', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        json(200, { external: { apple: true, azure: false, email: true, google: true } }),
      ),
    );
    const availability = await fetchProviderAvailability(env, fetchImpl, 'android');
    expect(availability).toEqual({ apple: true, google: false, microsoft: false, email: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://project-ref.supabase.test/auth/v1/settings', {
      headers: { apikey: 'sb_publishable_jest0000' },
    });
  });

  it('assumes availability when the settings cannot be read', async () => {
    const failing = jest.fn(() => Promise.reject(new TypeError('offline')));
    expect(await fetchProviderAvailability(env, failing as never, 'android')).toEqual({
      apple: true,
      google: false,
      microsoft: true,
      email: true,
    });
  });
});

describe('post-sign-in pipeline', () => {
  it('registers the device, fetches bootstrap and runs the registered hooks', async () => {
    const api = installApi({
      'POST /devices/register': () =>
        json(
          200,
          ok({
            installation_id: uuid(9),
            push_enabled: false,
            rebound_from_other_user: false,
            timezone_applied: true,
          }),
        ),
      'GET /me/bootstrap': () => json(200, ok(bootstrap())),
    });
    const hook = jest.fn<PostSignInHook>();
    const off = registerPostSignInHook('revenuecat.log_in', hook);
    const result = await runPostSignIn(
      { userId: uuid(1), method: 'google', mode: 'signin', isNewUser: false },
      {
        api: api.client,
        queryClient: createAppQueryClient({ gcTime: Infinity }),
        installationId: () => uuid(9),
      },
    );
    off();
    expect(result.failedSteps).toEqual([]);
    expect(result.showNewAccountNotice).toBe(false);
    expect(hook).toHaveBeenCalledWith({
      userId: uuid(1),
      method: 'google',
      mode: 'signin',
      isNewUser: false,
    });
    const register = api.calls.find((c) => c.url.endsWith('/devices/register'));
    expect(register?.body).toMatchObject({
      installation_id: uuid(9),
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      app_version: '1.0.0',
      build_number: '42',
      push: { permission: 'undetermined', expo_push_token: null },
    });
  });

  it('asks about a new account when sign-in mode created a fresh profile', async () => {
    const fresh = bootstrap({
      profile: {
        ...bootstrap().profile,
        created_at: new Date().toISOString(),
        onboarding: { step: null, completed_at: null },
      },
    });
    expect(isFreshProfile(fresh)).toBe(true);
    const api = installApi({ 'GET /me/bootstrap': () => json(200, ok(fresh)) });
    const result = await runPostSignIn(
      { userId: uuid(1), method: 'apple', mode: 'signin', isNewUser: false },
      {
        api: api.client,
        queryClient: createAppQueryClient({ gcTime: Infinity }),
        installationId: () => null,
      },
    );
    expect(result.showNewAccountNotice).toBe(true);
    expect(result.failedSteps).toEqual(['devices_register']);
  });
});
