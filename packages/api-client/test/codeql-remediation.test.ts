/**
 * CodeQL js/polynomial-redos in `api.ts` (security-nightly, TST-CI-08): trailing slashes of the
 * base URL are cut by a scan, not `replace(/\/+$/, '')`, which took ~2 s on 50 000 "/" + "x".
 */
import { describe, expect, it } from 'vitest';

import { apiBaseUrl, createApiClient } from '../src/index.ts';
import { bootstrapData, json, mockFetch, ok } from './fixtures.ts';

const N = 50_000;
const BUDGET_MS = 200;

function fast<T>(fn: () => T): T {
  const start = performance.now();
  const value = fn();
  expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  return value;
}

describe('CodeQL js/polynomial-redos: api.ts trailing slashes', () => {
  it('api.ts:125 apiBaseUrl trims 50 000 "/" quickly', () => {
    expect(fast(() => apiBaseUrl(`https://p.supabase.co${'/'.repeat(N)}`))).toBe(
      'https://p.supabase.co/functions/v1/api',
    );
    const odd = `https://p.supabase.co${'/'.repeat(N)}x`;
    expect(fast(() => apiBaseUrl(odd))).toBe(`${odd}/functions/v1/api`);
  });

  it('matches replace(/\\/+$/, "") for every short slash pattern', () => {
    for (const tail of ['', '/', '//', '/a', 'a/', '/a//', '///a///']) {
      const url = `https://p.supabase.co${tail}`;
      expect(apiBaseUrl(url)).toBe(`${url.replace(/\/+$/, '')}/functions/v1/api`);
    }
  });

  it('api.ts:286 createApiClient trims its base URL quickly', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const api = fast(() =>
      createApiClient({
        baseUrl: `https://p.supabase.co/functions/v1/api${'/'.repeat(N)}`,
        publishableKey: 'sb_publishable_test',
        getAccessToken: () => null,
        clientHeader: 'ios/1.0.0 (1)',
        fetch: mock.fn,
      }),
    );
    await api.call('GET /me/bootstrap');
    expect(mock.calls[0]?.url).toBe('https://p.supabase.co/functions/v1/api/me/bootstrap');
  });
});
