import { adminRoutes } from '@da/validation';
import { describe, expect, it, vi } from 'vitest';

import { buildPath, buildQuery, createAdminApiClient } from '../admin-api';
import {
  ADMIN_RESPONSES,
  REVEAL_ROUTES,
  routeConfirmation,
  routePermission,
  routeRequiresReason,
} from '../admin-contracts';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const BASE = 'https://api.example.test/functions/v1/admin-api';
const SECRET = 'bff-secret-for-tests-000000000000000000';
const TOKEN = 'header.payload.signature';

function meta() {
  return {
    correlation_id: '0190f5e0-0000-7000-8000-00000000c0de',
    request_id: 'req-1',
    server_time: '2026-09-24T09:00:00.000Z',
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorBody(code: string, details?: Record<string, unknown>) {
  return {
    error: {
      code,
      message: code,
      message_key: `errors.${code.toLowerCase()}`,
      retryable: false,
      correlation_id: 'corr-err',
      ...(details === undefined ? {} : { details }),
    },
  };
}

function client(fetchImpl: typeof fetch) {
  return createAdminApiClient({
    baseUrl: BASE,
    bffSecret: SECRET,
    fetch: fetchImpl,
    retryDelaysMs: [0, 0],
  });
}

describe('typed admin-api registry map', () => {
  it('uses exactly the schema objects the @da/validation registry holds', () => {
    for (const [key, schema] of Object.entries(ADMIN_RESPONSES)) {
      expect(adminRoutes[key as keyof typeof adminRoutes].response, key).toBe(schema);
    }
  });

  it('derives reason / confirm / step-up / permission from the route contracts', () => {
    expect(routeConfirmation('POST /users/:id/reveal')).toEqual({
      requiresReason: true,
      requiresConfirm: true,
      requiresStepUp: false,
    });
    expect(routeRequiresReason('POST /session/logout-all')).toBe(false);
    expect(routeConfirmation('POST /session/logout-all').requiresConfirm).toBe(true);
    expect(routeConfirmation('POST /admins/:id/disable').requiresStepUp).toBe(true);
    expect(routeRequiresReason('PATCH /preferences')).toBe(false);
    expect(routePermission('POST /users/:id/reveal')).toBe('users.pii.reveal');
    expect(routePermission('GET /me')).toBeNull();
    for (const key of REVEAL_ROUTES) expect(routeRequiresReason(key), key).toBe(true);
  });
});

describe('createAdminApiClient', () => {
  it('builds paths and queries', () => {
    expect(buildPath('/users/:id/reveal', { id: 'a b' })).toBe('/users/a%20b/reveal');
    expect(buildPath('/users/:id', {})).toBeNull();
    expect(buildQuery({ range: '7d', 'filter[plan]': 'pro', q: undefined })).toBe(
      '?range=7d&filter%5Bplan%5D=pro',
    );
  });

  it('sends the BFF key, bearer token, correlation id and activity, and parses via the registry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(200, { data: { idle_expires_at: '2026-09-24T09:30:00+00:00' }, meta: meta() }),
      );
    const result = await client(fetchMock).call(
      'POST /session/heartbeat',
      { body: {} },
      { token: TOKEN, idempotencyKey: '0190f5e0-0000-7000-8000-000000000042' },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { idle_expires_at: '2026-09-24T09:30:00+00:00' },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/session/heartbeat`);
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-da-bff']).toBe(SECRET);
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['idempotency-key']).toBe('0190f5e0-0000-7000-8000-000000000042');
    expect(headers['x-da-activity']).toBe('user');
    expect(headers['x-correlation-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(headers.origin).toBeUndefined();
    expect(init?.cache).toBe('no-store');
    expect(init?.method).toBe('POST');
  });

  it('generates an idempotency key for mutations and none for reads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { data: { ended_sessions: 2 }, meta: meta() }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { results: [] }, meta: meta() }));
    await client(fetchMock).call(
      'POST /session/logout-all',
      { body: { confirm: true } },
      { token: TOKEN },
    );
    await client(fetchMock).call(
      'GET /search',
      { query: { q: 'abc' } },
      { token: TOKEN, activity: 'background' },
    );
    const mutation = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const read = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(mutation['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      confirm: true,
      scope: 'all',
    });
    expect(read['idempotency-key']).toBeUndefined();
    expect(read['x-da-activity']).toBe('background');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${BASE}/search?q=abc`);
  });

  it('refuses requests that violate the route contract before anything is sent', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const badBody = await client(fetchMock).call(
      'POST /users/:id/reveal',
      { params: { id: 'not-a-uuid' }, body: { field: 'email' } },
      { token: TOKEN },
    );
    expect(badBody).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    const shortQuery = await client(fetchMock).call(
      'GET /search',
      { query: { q: 'a' } },
      { token: TOKEN },
    );
    expect(shortQuery).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    const noToken = await client(fetchMock).call('GET /me', {}, { token: null });
    expect(noToken).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends BFF-only routes without a bearer token', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { data: { allowed: true }, meta: meta() }));
    const hash = 'a'.repeat(64);
    const result = await client(fetchMock).call('POST /auth/preflight', {
      body: { email_hash: hash, ip_hash: hash },
    });
    expect(result.ok).toBe(true);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-da-bff']).toBe(SECRET);
  });

  it('flags a response that violates the contract', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { data: { wrong: true }, meta: meta() }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await client(fetchMock).call('GET /me', {}, { token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { code: 'CONTRACT_VIOLATION', status: 200 } });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('maps the error envelope, keeps details and Retry-After', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(429, errorBody('RATE_LIMITED'), { 'retry-after': '42' }));
    const result = await client(fetchMock).call(
      'POST /session/heartbeat',
      { body: {} },
      { token: TOKEN },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', status: 429, correlationId: 'corr-err', retryAfter: 42 },
    });
    const revoked = await client(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(401, errorBody('AUTH_REQUIRED', { reason: 'session_revoked' })),
        ),
    ).call('GET /me', {}, { token: TOKEN });
    expect(revoked).toMatchObject({
      ok: false,
      error: { code: 'AUTH_REQUIRED', details: { reason: 'session_revoked' } },
    });
  });

  it('retries reads twice on 503 and network errors but never retries a mutation', async () => {
    const read = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(503, errorBody('SERVICE_UNAVAILABLE')))
      .mockResolvedValueOnce(jsonResponse(200, { data: { results: [] }, meta: meta() }));
    const result = await client(read).call(
      'GET /search',
      { query: { q: 'abc' } },
      { token: TOKEN },
    );
    expect(result.ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);

    const write = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(503, errorBody('SERVICE_UNAVAILABLE')));
    const failed = await client(write).call(
      'POST /session/heartbeat',
      { body: {} },
      { token: TOKEN },
    );
    expect(failed).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(write).toHaveBeenCalledTimes(1);

    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const unreachable = await client(down).call('GET /me', {}, { token: TOKEN });
    expect(unreachable).toMatchObject({ ok: false, error: { code: 'NETWORK_ERROR' } });
    expect(down).toHaveBeenCalledTimes(3);
  });
});
