import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, mk, qk } from '../src/index.ts';
import {
  BOOTSTRAP_RETRY_DELAYS_MS,
  appleExchangeMutationOptions,
  bootstrapQueryOptions,
  registerDeviceMutationOptions,
  shouldRetry,
  unregisterDeviceMutationOptions,
} from '../src/hooks/index.ts';
import { bootstrapData, json, mockFetch, ok, uuid } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

describe('query keys', () => {
  it('nests detail keys under their area root', () => {
    expect(qk.me.bootstrap()).toEqual(['me', 'bootstrap']);
    expect(qk.me.entitlements()).toEqual(['me', 'entitlements']);
    expect(qk.today.day('2026-09-24')).toEqual(['today', '2026-09-24']);
    expect(qk.briefings.list()).toEqual(['briefings', 'list', { cursor: null }]);
    expect(qk.onboarding.firstAnalysis('job')).toEqual(['onboarding', 'first-analysis', 'job']);
    for (const area of Object.values(qk)) {
      for (const [name, build] of Object.entries(area)) {
        if (name === 'all' || typeof build !== 'function') continue;
        const key = (build as (arg: string) => readonly unknown[])('x');
        expect(key.slice(0, area.all.length)).toEqual(area.all);
      }
    }
  });

  it('names the queued mutations', () => {
    expect(mk.devices.register).toEqual(['devices', 'register']);
    expect(mk.auth.appleExchange).toEqual(['auth', 'apple-exchange']);
  });
});

describe('bootstrap query options', () => {
  it('fetches through the client, marks the cache persistable and uses the §0.4 key', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const options = bootstrapQueryOptions(api(mock.fn));
    expect(options.queryKey).toEqual(['me', 'bootstrap']);
    expect(options.meta).toEqual({ persist: true });
    expect(options.staleTime).toBe(5 * 60_000);
    const data = await new QueryClient().query(options);
    expect(data.account_state).toBe('active');
  });

  it('retries transient failures three times with the API-BOOT-01 delays', () => {
    const transient = new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null });
    const permanent = new ApiError({ code: 'AUTH_REQUIRED', kind: 'server', status: 401 });
    expect(shouldRetry(0, transient, 3)).toBe(true);
    expect(shouldRetry(3, transient, 3)).toBe(false);
    expect(shouldRetry(0, permanent, 3)).toBe(false);
    expect(shouldRetry(0, new Error('x'), 3)).toBe(false);
    expect(BOOTSTRAP_RETRY_DELAYS_MS).toEqual([500, 2000, 8000]);
  });
});

describe('mutation options', () => {
  const body = {
    installation_id: uuid(9),
    platform: 'android' as const,
    os_version: '35',
    app_version: '1.0.0',
    build_number: '7',
    locale: 'en-US' as const,
    timezone: 'Europe/Istanbul',
    push: { permission: 'denied' as const, expo_push_token: null },
    device_fingerprint_hash: null,
  };

  it('register sends the caller idempotency key', async () => {
    const mock = mockFetch(() =>
      json(
        200,
        ok({
          installation_id: uuid(9),
          push_enabled: false,
          rebound_from_other_user: false,
          timezone_applied: false,
        }),
      ),
    );
    const observer = new MutationObserver(
      new QueryClient(),
      registerDeviceMutationOptions(api(mock.fn)),
    );
    const data = await observer.mutate({ body, idempotencyKey: uuid(55) });
    expect(data.installation_id).toBe(uuid(9));
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(55));
  });

  it('unregister and apple exchange call their routes', async () => {
    const mock = mockFetch(
      () => json(200, ok({ disabled_tokens: 1 })),
      () => json(200, ok({ stored: true })),
    );
    const client = api(mock.fn);
    const qc = new QueryClient();
    await new MutationObserver(qc, unregisterDeviceMutationOptions(client)).mutate({
      body: { installation_id: uuid(9), reason: 'logout' },
    });
    await new MutationObserver(qc, appleExchangeMutationOptions(client)).mutate({
      body: { authorization_code: 'c'.repeat(20), identity_token_sub: '000123.abc' },
    });
    expect(mock.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/functions/v1/api/devices/unregister',
      '/functions/v1/api/auth/apple/exchange',
    ]);
    expect(mock.calls.every((c) => typeof c.headers['idempotency-key'] === 'string')).toBe(true);
  });
});
