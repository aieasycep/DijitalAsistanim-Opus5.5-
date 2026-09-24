import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiBaseUrl, createApiClient, type ApiClientConfig } from '../src/index.ts';
import {
  UUID_RE,
  bootstrapData,
  errorBody,
  json,
  mockFetch,
  ok,
  uuid,
  type Recorded,
} from './fixtures.ts';

const BASE = 'https://api.dijitalasistan.app/functions/v1/api';

function client(fetchFn: ApiClientConfig['fetch'], extra: Partial<ApiClientConfig> = {}) {
  return createApiClient({
    baseUrl: BASE,
    publishableKey: 'sb_publishable_test',
    getAccessToken: () => 'token-1',
    clientHeader: 'ios/1.0.0 (42)',
    getInstallationId: () => uuid(9),
    getLocale: () => 'tr-TR',
    apiVersion: '2026-09-23',
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
    ...extra,
  });
}

const registerBody = {
  installation_id: uuid(9),
  platform: 'ios' as const,
  os_version: '18.0',
  app_version: '1.0.0',
  build_number: '42',
  locale: 'tr-TR' as const,
  timezone: 'Europe/Istanbul',
  push: { permission: 'undetermined' as const, expo_push_token: null },
  device_fingerprint_hash: null,
};

const registered = {
  installation_id: uuid(9),
  push_enabled: false,
  rebound_from_other_user: false,
  timezone_applied: true,
};

describe('apiBaseUrl', () => {
  it('points at the api function of a project URL', () => {
    expect(apiBaseUrl('https://api.dijitalasistan.app/')).toBe(BASE);
  });
});

describe('call(): success path', () => {
  it('sends the auth, correlation and client headers and parses the envelope', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const response = await client(mock.fn).call('GET /me/bootstrap');
    expect(response.data.profile.display_name).toBe('Yunus');
    expect(response.meta.correlation_id).toBe('corr-12345678');
    const [call] = mock.calls as [Recorded];
    expect(call.url).toBe(`${BASE}/me/bootstrap`);
    expect(call.init.method).toBe('GET');
    expect(call.init.body).toBeUndefined();
    expect(call.headers).toMatchObject({
      authorization: 'Bearer token-1',
      apikey: 'sb_publishable_test',
      'x-da-client': 'ios/1.0.0 (42)',
      'x-da-installation-id': uuid(9),
      'x-da-api-version': '2026-09-23',
      'accept-language': 'tr-TR',
      accept: 'application/json',
    });
    expect(call.headers['x-correlation-id']).toMatch(UUID_RE);
    expect(call.headers['idempotency-key']).toBeUndefined();
    expect(call.headers['content-type']).toBeUndefined();
  });

  it('omits the bearer header when signed out', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    await client(mock.fn, { getAccessToken: () => null }).call('GET /me/bootstrap');
    expect(mock.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('keeps a valid caller correlation id and replaces an invalid one', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const api = client(mock.fn);
    await api.call('GET /me/bootstrap', {}, { correlationId: 'screen-today-0001' });
    await api.call('GET /me/bootstrap', {}, { correlationId: 'bad id!' });
    expect(mock.calls[0]?.headers['x-correlation-id']).toBe('screen-today-0001');
    expect(mock.calls[1]?.headers['x-correlation-id']).toMatch(UUID_RE);
  });

  it('fills path parameters and serialises the query string', async () => {
    const mock = mockFetch(() => json(404, errorBody('NOT_FOUND')));
    const api = client(mock.fn);
    await api
      .call('GET /onboarding/first-analysis/:jobId', { params: { jobId: uuid(5) } })
      .catch(() => undefined);
    await api
      .call('GET /plan/free-slots', {
        query: { from: '2026-09-24T08:00:00Z', to: '2026-09-24T18:00:00Z', min_minutes: 45 },
      })
      .catch(() => undefined);
    expect(mock.calls[0]?.url).toBe(`${BASE}/onboarding/first-analysis/${uuid(5)}`);
    const url = new URL(mock.calls[1]?.url ?? '');
    expect(url.pathname).toBe('/functions/v1/api/plan/free-slots');
    expect(url.searchParams.get('from')).toBe('2026-09-24T08:00:00Z');
    expect(url.searchParams.get('min_minutes')).toBe('45');
    // The validated raw input is sent; the server applies the schema defaults itself.
    expect(url.searchParams.has('within_working_hours')).toBe(false);
  });
});

describe('call(): idempotency', () => {
  it('adds an Idempotency-Key to [IK] routes and a JSON body', async () => {
    const mock = mockFetch(() => json(200, ok(registered)));
    const response = await client(mock.fn).call('POST /devices/register', { body: registerBody });
    expect(response.data.timezone_applied).toBe(true);
    const [call] = mock.calls as [Recorded];
    expect(call.headers['idempotency-key']).toMatch(UUID_RE);
    expect(call.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(call.init.body as string)).toEqual(registerBody);
  });

  it('reuses the caller key so a retried intent is deduplicated server-side', async () => {
    const mock = mockFetch(() => json(200, ok(registered)));
    const api = client(mock.fn);
    const key = uuid(77);
    await api.call('POST /devices/register', { body: registerBody }, { idempotencyKey: key });
    await api.call('POST /devices/register', { body: registerBody }, { idempotencyKey: key });
    expect(mock.calls.map((c) => c.headers['idempotency-key'])).toEqual([key, key]);
  });

  it('sends no key on routes whose mode is not `header`', async () => {
    const mock = mockFetch(() => json(202, ok({ accepted: 1, dropped: 0 })));
    const response = await client(mock.fn).call('POST /analytics/events', {
      body: { session_id: uuid(8), events: [{ name: 'app_opened', ts: '2026-09-24T08:00:00Z' }] },
    });
    expect(response.data.accepted).toBe(1);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.headers['idempotency-key']).toBeUndefined();
  });
});

describe('call(): errors', () => {
  it('maps the error envelope to a typed ApiError', async () => {
    const body = errorBody('ENTITLEMENT_REQUIRED', {
      details: { feature: 'midday' },
      message_key: 'errors.entitlement_required',
    });
    const mock = mockFetch(() => json(402, body));
    const error = await client(mock.fn)
      .call('POST /devices/register', { body: registerBody })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      kind: 'server',
      status: 402,
      retryable: false,
      messageKey: 'errors.entitlement_required',
      correlationId: 'corr-server-1',
      details: { feature: 'midday' },
    });
  });

  it('keeps the server retryable flag, field errors and Retry-After', async () => {
    const body = errorBody('RATE_LIMITED', {
      retryable: true,
      field_errors: [{ path: 'x', code: 'too_big', message_key: 'validation.too_big' }],
    });
    const mock = mockFetch(() => json(429, body, { 'retry-after': '3' }));
    const error = (await client(mock.fn)
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(3000);
    expect(error.fieldErrors).toHaveLength(1);
  });

  it('maps a non-envelope gateway error by HTTP status', async () => {
    const mock = mockFetch(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'x-correlation-id': 'gw-1234567' },
        }),
    );
    const error = (await client(mock.fn)
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      kind: 'http',
      status: 502,
      retryable: true,
      messageKey: 'errors.provider_unavailable',
      correlationId: 'gw-1234567',
    });
  });

  it('rejects an unknown error code as an HTTP-status error', async () => {
    const mock = mockFetch(() => json(500, errorBody('SOMETHING_NEW')));
    const error = (await client(mock.fn)
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', kind: 'http' });
  });

  it('refreshes the token once after 401 AUTH_REQUIRED and re-sends with the same keys', async () => {
    const mock = mockFetch(
      () => json(401, errorBody('AUTH_REQUIRED')),
      () => json(200, ok(registered)),
    );
    const refresh = vi.fn(() => Promise.resolve('token-2'));
    const response = await client(mock.fn, { refreshAccessToken: refresh }).call(
      'POST /devices/register',
      { body: registerBody },
    );
    expect(response.data.installation_id).toBe(uuid(9));
    expect(refresh).toHaveBeenCalledTimes(1);
    const [first, second] = mock.calls as [Recorded, Recorded];
    expect(second.headers.authorization).toBe('Bearer token-2');
    expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
    expect(second.headers['x-correlation-id']).toBe(first.headers['x-correlation-id']);
  });

  it('gives up after one refresh and never refreshes for REAUTH_REQUIRED', async () => {
    const twice = mockFetch(() => json(401, errorBody('AUTH_REQUIRED')));
    const refresh = vi.fn(() => Promise.resolve('token-2'));
    const error = (await client(twice.fn, { refreshAccessToken: refresh })
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('AUTH_REQUIRED');
    expect(twice.calls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    const reauth = mockFetch(() => json(401, errorBody('REAUTH_REQUIRED')));
    const refresh2 = vi.fn(() => Promise.resolve('token-2'));
    const error2 = (await client(reauth.fn, { refreshAccessToken: refresh2 })
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error2.code).toBe('REAUTH_REQUIRED');
    expect(refresh2).not.toHaveBeenCalled();
  });

  it('validates the request before sending', async () => {
    const mock = mockFetch(() => json(200, ok(registered)));
    const error = (await client(mock.fn)
      .call('POST /devices/register', { body: { ...registerBody, timezone: 'Mars/Base' } })
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', kind: 'invalid_request' });
    expect(error.fieldErrors[0]?.path).toBe('timezone');
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects a success body that breaks the response contract', async () => {
    const mock = mockFetch(() => json(200, ok({ ...bootstrapData, config: {} })));
    const error = (await client(mock.fn)
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', kind: 'invalid_response', status: 200 });
  });

  it('blocks the call with OFFLINE_BLOCKED before touching the network', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const error = (await client(mock.fn, { isOffline: () => true })
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({
      code: 'OFFLINE_BLOCKED',
      kind: 'offline',
      status: null,
      messageKey: 'errors.offline_blocked',
    });
    expect(mock.calls).toHaveLength(0);
  });

  it('maps a network failure to a retryable SERVICE_UNAVAILABLE', async () => {
    const failing = () => Promise.reject(new TypeError('Network request failed'));
    const error = (await client(failing)
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', kind: 'network', retryable: true });
    expect(error.correlationId).toMatch(UUID_RE);
  });

  it('reports every ApiError to onError', async () => {
    const onError = vi.fn();
    const mock = mockFetch(() => json(426, errorBody('CLIENT_UPGRADE_REQUIRED')));
    await client(mock.fn, { onError })
      .call('GET /me/entitlements')
      .catch(() => undefined);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CLIENT_UPGRADE_REQUIRED' }),
      'GET /me/entitlements',
    );
  });
});

describe('call(): timeout and abort', () => {
  function hanging(_url: string, init: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const fail = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init.signal?.aborted === true) fail();
      init.signal?.addEventListener('abort', fail);
    });
  }

  it('fails with UPSTREAM_TIMEOUT when the timeout elapses', async () => {
    const error = (await client(hanging, { timeoutMs: 20 })
      .call('GET /me/bootstrap')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      kind: 'timeout',
      retryable: true,
      details: { reason: 'client_timeout' },
    });
  });

  it('propagates a caller abort as an AbortError', async () => {
    const controller = new AbortController();
    const pending = client(hanging).call('GET /me/bootstrap', {}, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('AbortError');
  });
});
