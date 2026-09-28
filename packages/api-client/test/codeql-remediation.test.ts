/**
 * CodeQL js/polynomial-redos in `api.ts` (security-nightly, TST-CI-08): trailing slashes of the
 * base URL are cut by a scan, not `replace(/\/+$/, '')`, which took ~2 s on 50 000 "/" + "x".
 */
import { describe, expect, it } from 'vitest';

import { apiBaseUrl, createApiClient } from '../src/index.ts';
import { bootstrapData, json, mockFetch, ok } from './fixtures.ts';

const N = 50_000;

/**
 * Growth-rate check rather than a wall-clock budget (a fixed 200 ms budget failed on a loaded CI
 * runner): `fn(n)` runs at N / 4 and at N, best of three each. A linear scan grows about 4×; the
 * quadratic originals grow about 16× and took seconds at N. A run under FLOOR_MS passes outright.
 */
const FLOOR_MS = 100;
const MAX_GROWTH = 8;
/** For an input built outside the call (fixed size): best of three within a generous budget. */
const BOUNDED_MS = 1000;

function timedRun<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function best<T>(fn: () => T): { value: T; ms: number } {
  let run = timedRun(fn);
  for (let i = 0; i < 2; i++) {
    const next = timedRun(fn);
    if (next.ms < run.ms) run = next;
  }
  return run;
}

function linear<T>(fn: (n: number) => T): T {
  const small = best(() => fn(N / 4));
  const large = best(() => fn(N));
  const ok = large.ms < FLOOR_MS || large.ms < MAX_GROWTH * Math.max(small.ms, 1);
  expect(
    ok ? 'linear' : `${large.ms.toFixed(1)} ms at N vs ${small.ms.toFixed(1)} ms at N / 4`,
  ).toBe('linear');
  return large.value;
}

function bounded<T>(fn: () => T): T {
  const run = best(fn);
  expect(run.ms).toBeLessThan(BOUNDED_MS);
  return run.value;
}

describe('CodeQL js/polynomial-redos: api.ts trailing slashes', () => {
  it('api.ts:125 apiBaseUrl trims 50 000 "/" quickly', () => {
    expect(linear((N) => apiBaseUrl(`https://p.supabase.co${'/'.repeat(N)}`))).toBe(
      'https://p.supabase.co/functions/v1/api',
    );
    const odd = `https://p.supabase.co${'/'.repeat(N)}x`;
    expect(bounded(() => apiBaseUrl(odd))).toBe(`${odd}/functions/v1/api`);
  });

  it('matches replace(/\\/+$/, "") for every short slash pattern', () => {
    for (const tail of ['', '/', '//', '/a', 'a/', '/a//', '///a///']) {
      const url = `https://p.supabase.co${tail}`;
      expect(apiBaseUrl(url)).toBe(`${url.replace(/\/+$/, '')}/functions/v1/api`);
    }
  });

  it('api.ts:286 createApiClient trims its base URL quickly', async () => {
    const mock = mockFetch(() => json(200, ok(bootstrapData)));
    const api = linear((N) =>
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
