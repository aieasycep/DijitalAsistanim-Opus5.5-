import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { ProviderError, type ServerProviderAdapters } from '@da/domain';
import { AppError } from '../errors.ts';
import { testEnv } from '../testing/env.ts';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { testDb } from '../testing/db.ts';
import {
  assertDemoAllowed,
  DemoModeForbiddenError,
  demoModeState,
  isDemoEnabled,
} from './demo/guard.ts';
import {
  accountStatusChange,
  classifyProviderFailure,
  parseRetryAfter,
  providerErrorToAppError,
} from './errors.ts';
import { providerFetch, supabaseQuotaGate } from './http.ts';
import { createProviderRegistry } from './registry.ts';

Deno.test('demo guard: DEMO_MODE in production refuses to start unless explicitly allowed', () => {
  assertEquals(demoModeState({ APP_ENV: 'development' }), 'off');
  assertEquals(demoModeState({ APP_ENV: 'development', DEMO_MODE: 'true' }), 'on');
  assertEquals(demoModeState({ APP_ENV: 'production', DEMO_MODE: 'true' }), 'forbidden');
  assertEquals(
    demoModeState({ APP_ENV: 'production', DEMO_MODE: '1', ALLOW_DEMO_IN_PRODUCTION: 'true' }),
    'on',
  );
  assertThrows(
    () => assertDemoAllowed({ APP_ENV: 'production', DEMO_MODE: 'true' }),
    DemoModeForbiddenError,
  );
  assertEquals(assertDemoAllowed({ APP_ENV: 'production' }), 'off');
  assertEquals(isDemoEnabled({ APP_ENV: 'staging', DEMO_MODE: 'false' }), false);
});

const fakeAdapters = () => ({ oauth: {} }) as unknown as ServerProviderAdapters;

Deno.test(
  'registry: providers without credentials are EXTERNAL_CREDENTIAL_REQUIRED, never a fake success',
  () => {
    const registry = createProviderRegistry(
      { google: fakeAdapters, microsoft: fakeAdapters, demo: fakeAdapters },
      testEnv(),
    );
    assertEquals(registry.available(), []);
    const error = assertThrows(() => registry.resolve('google'), AppError);
    assertEquals(error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(error.details, {
      feature: 'integrations.google',
      credential_keys: [
        'GOOGLE_OAUTH_CLIENT_ID',
        'GOOGLE_OAUTH_CLIENT_SECRET',
        'GOOGLE_OAUTH_REDIRECT_URI',
      ],
    });
    assertEquals(assertThrows(() => registry.resolve('demo'), AppError).code, 'FEATURE_DISABLED');
  },
);

Deno.test(
  'registry: configured providers resolve once; unregistered factories are FEATURE_DISABLED',
  () => {
    let built = 0;
    const env = testEnv({
      GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: crypto.randomUUID(),
      GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.com/functions/v1/oauth/google/callback',
      DEMO_MODE: 'true',
    });
    const registry = createProviderRegistry(
      {
        google: () => {
          built++;
          return fakeAdapters();
        },
        demo: fakeAdapters,
      },
      env,
    );
    assertEquals(registry.available().sort(), ['demo', 'google']);
    assert(registry.resolve('google') === registry.resolve('google'));
    assertEquals(built, 1);
    const withMicrosoft = createProviderRegistry(
      {},
      {
        ...env,
        MICROSOFT_CLIENT_ID: 'id',
        MICROSOFT_CERT_PRIVATE_KEY: 'k',
        MICROSOFT_CERT_THUMBPRINT_S256: 't',
        MICROSOFT_OAUTH_REDIRECT_URI: 'https://x',
      },
    );
    const error = assertThrows(() => withMicrosoft.resolve('microsoft'), AppError);
    assertEquals(error.code, 'FEATURE_DISABLED');
    assertEquals(error.details?.reason, 'provider_not_registered');
  },
);

Deno.test('provider failures are classified by status and reason codes only', () => {
  assertEquals(classifyProviderFailure(400, { code: 'invalid_grant' }).code, 'auth_invalid_grant');
  assertEquals(
    classifyProviderFailure(400, { code: 'invalid_grant', reason: 'AADSTS700082' }).code,
    'auth_invalid_grant',
  );
  assertEquals(
    classifyProviderFailure(403, { reason: 'AADSTS90094' }).code,
    'consent_admin_required',
  );
  assertEquals(
    classifyProviderFailure(403, { reason: 'insufficientPermissions' }).code,
    'scope_missing',
  );
  assertEquals(
    classifyProviderFailure(403, { reason: 'dailyLimitExceeded' }).code,
    'quota_exhausted_daily',
  );
  assertEquals(classifyProviderFailure(429, {}, 5000).retryAfterMs, 5000);
  assertEquals(classifyProviderFailure(401).code, 'auth_token_rejected');
  assertEquals(classifyProviderFailure(404).code, 'not_found');
  assertEquals(classifyProviderFailure(410, { reason: 'fullSyncRequired' }).code, 'cursor_invalid');
  assertEquals(classifyProviderFailure(412).code, 'precondition_failed');
  assertEquals(classifyProviderFailure(503).code, 'provider_unavailable');
  assertEquals(
    classifyProviderFailure(401, { code: 'invalid_client' }).code,
    'client_credential_invalid',
  );
  assertEquals(parseRetryAfter('7'), 7000);
  assertEquals(
    parseRetryAfter('Wed, 23 Sep 2026 07:00:10 GMT', Date.parse('2026-09-23T07:00:00Z')),
    10_000,
  );
  assertEquals(parseRetryAfter(null), null);
});

Deno.test('provider errors map to API codes and account status changes', () => {
  const reauth = providerErrorToAppError(
    new ProviderError('auth_invalid_grant', 400),
    'google',
    'acc-1',
  );
  assertEquals(reauth.code, 'PROVIDER_REAUTH_REQUIRED');
  assertEquals(reauth.details, { provider: 'google', account_id: 'acc-1' });
  const limited = providerErrorToAppError(
    new ProviderError('rate_limited', 429, 2500),
    'microsoft',
  );
  assertEquals(limited.code, 'PROVIDER_RATE_LIMITED');
  assertEquals(limited.headers['Retry-After'], '3');
  assertEquals(accountStatusChange(new ProviderError('auth_invalid_grant')), {
    status: 'needs_reauth',
    statusReason: 'invalid_grant',
  });
  assertEquals(accountStatusChange(new ProviderError('rate_limited')), null);
});

Deno.test(
  'providerFetch retries idempotent 5xx, honours a short Retry-After and never retries a POST',
  async () => {
    const slept: number[] = [];
    const sleep = (ms: number) => Promise.resolve(void slept.push(ms));
    let n = 0;
    const flaky = stubFetch(() =>
      ++n < 3 ? new Response('x', { status: 503 }) : jsonResponse({ ok: true }),
    );
    const ok = await providerFetch(
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile' },
      { fetch: flaky.fetch, sleep },
    );
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
    assertEquals(slept, [250, 1000]);

    slept.length = 0;
    let m = 0;
    const throttled = stubFetch(() =>
      ++m === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '1' } })
        : jsonResponse({}),
    );
    const after = await providerFetch(
      { url: 'https://graph.microsoft.com/v1.0/me' },
      { fetch: throttled.fetch, sleep },
    );
    await after.body?.cancel();
    assertEquals(slept, [1000]);

    const post = stubFetch(() => new Response('x', { status: 503 }));
    const error = await assertRejects(
      () =>
        providerFetch(
          { url: 'https://graph.microsoft.com/v1.0/me/sendMail', method: 'POST', body: '{}' },
          { fetch: post.fetch, sleep },
        ),
      ProviderError,
    );
    assertEquals(error.code, 'provider_unavailable');
    assertEquals(post.calls.length, 1);
  },
);

Deno.test(
  'providerFetch surfaces long Retry-After as rate_limited and reports reauth to the caller',
  async () => {
    const sleep = () => Promise.resolve();
    const long = stubFetch(
      () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
    );
    const limited = await assertRejects(
      () => providerFetch({ url: 'https://x.example/a' }, { fetch: long.fetch, sleep }),
      ProviderError,
    );
    assertEquals(limited.code, 'rate_limited');
    assertEquals(limited.retryAfterMs, 120_000);
    assertEquals(long.calls.length, 1);

    const changes: string[] = [];
    const revoked = stubFetch(() =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        400,
      ),
    );
    const error = await assertRejects(
      () =>
        providerFetch(
          {
            url: 'https://oauth2.googleapis.com/token',
            method: 'POST',
            body: 'grant_type=refresh_token',
          },
          {
            fetch: revoked.fetch,
            sleep,
            onAccountStatus: (c) => void changes.push(`${c.status}:${c.statusReason}`),
          },
        ),
      ProviderError,
    );
    assertEquals(error.code, 'auth_invalid_grant');
    assertEquals(changes, ['needs_reauth:invalid_grant']);
  },
);

Deno.test(
  'the quota gate calls private.consume_provider_quota and waits, or fails past the max wait',
  async () => {
    let waits = [300, 0];
    const stub = stubFetch(() => jsonResponse(waits.shift() ?? 0));
    const slept: number[] = [];
    const gate = supabaseQuotaGate(testDb(stub.fetch), 'acc-1', {
      sleep: (ms) => Promise.resolve(void slept.push(ms)),
    });
    await gate.acquire('gmail_user_units', 5, { priority: 'backfill' });
    assertEquals(slept, [300]);
    assert(stub.calls[0]?.url.endsWith('/rest/v1/rpc/consume_provider_quota'));
    assertEquals(stub.calls[0]?.headers.get('Content-Profile'), 'private');
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      p_bucket: 'gmail_user_units',
      p_account: 'acc-1',
      p_units: 5,
      p_limit: 2000,
      p_window_seconds: 60,
    });
    waits = [10_000];
    const error = await assertRejects(() => gate.acquire('gcal_user_requests', 1), ProviderError);
    assertEquals(error.code, 'rate_limited');
  },
);
