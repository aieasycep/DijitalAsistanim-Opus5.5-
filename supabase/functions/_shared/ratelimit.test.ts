import { assert, assertEquals } from '@std/assert';
import { createApp } from './http/app.ts';
import { sendData } from './http/respond.ts';
import { createLogger, memorySink } from './logging/logger.ts';
import {
  rateLimit,
  type RateLimitStore,
  supabaseRateLimitStore,
  windowStart,
} from './ratelimit.ts';
import { jsonResponse, stubFetch } from './testing/fetch.ts';
import { testDb } from './testing/db.ts';
import type { UserAuth } from './http/context.ts';

const USER = '11111111-1111-4111-8111-111111111111';

function countingStore(limit: number): RateLimitStore & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    hit(key) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve({ allowed: n <= limit, count: n });
    },
  };
}

function appWith(store: RateLimitStore, now = 1_000_000_000_000) {
  const app = createApp({
    fn: 'api',
    logger: createLogger({ fn: 'api', sink: memorySink().sink }),
  });
  app.use('*', async (c, next) => {
    c.set('auth', {
      userId: USER,
      aal: 'aal1',
      sessionId: null,
      jwt: 'x',
      claims: { sub: USER },
    } satisfies UserAuth);
    await next();
  });
  app.post(
    '/support/tickets',
    rateLimit({ store, scope: 'api', now: () => now }, 'support_ticket'),
    (c) => sendData(c, { ok: true }),
  );
  app.post(
    '/analytics/events',
    rateLimit({ store, scope: 'api', now: () => now }, 'analytics'),
    (c) => sendData(c, { ok: true }),
  );
  return app;
}

Deno.test(
  'rate-limited responses carry RateLimit-* headers; the 6th ticket in an hour is 429 with Retry-After',
  async () => {
    const store = countingStore(5);
    const app = appWith(store);
    for (let i = 1; i <= 5; i++) {
      const res = await app.request('/api/support/tickets', { method: 'POST' });
      assertEquals(res.status, 200);
      assertEquals(res.headers.get('RateLimit-Limit'), '5');
      assertEquals(res.headers.get('RateLimit-Remaining'), String(5 - i));
      assertEquals(res.headers.get('RateLimit-Policy'), '5;w=3600');
      assert(Number(res.headers.get('RateLimit-Reset')) > 0);
      await res.body?.cancel();
    }
    const denied = await app.request('/api/support/tickets', { method: 'POST' });
    assertEquals(denied.status, 429);
    assert(Number(denied.headers.get('Retry-After')) > 0);
    assertEquals((await denied.json()).error.code, 'RATE_LIMITED');
    assertEquals(store.keys[0], `api:support_ticket:u:${USER}`);
  },
);

Deno.test('installation-scoped classes key on X-DA-Installation-Id', async () => {
  const store = countingStore(60);
  const app = appWith(store);
  const res = await app.request('/api/analytics/events', {
    method: 'POST',
    headers: { 'X-DA-Installation-Id': 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
  });
  await res.body?.cancel();
  assertEquals(store.keys[0], 'api:analytics:i:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

Deno.test('the supabase store calls public.rate_limit_hit and reads the window count', async () => {
  const now = Date.parse('2026-09-23T07:00:30Z');
  const stub = stubFetch((call) =>
    call.url.includes('/rpc/rate_limit_hit') ? jsonResponse(true) : jsonResponse({ count: 3 }),
  );
  const client = testDb(stub.fetch);
  const hit = await supabaseRateLimitStore(client, () => now).hit('api:x:u:1', 10, 60);
  assertEquals(hit, { allowed: true, count: 3 });
  assertEquals(JSON.parse(stub.calls[0]?.body ?? ''), {
    p_key: 'api:x:u:1',
    p_limit: 10,
    p_window_seconds: 60,
  });
  const read = decodeURIComponent(stub.calls[1]?.url ?? '');
  assert(read.includes('rate_limits?select=count'));
  assert(read.includes(`window_start=eq.${new Date(windowStart(now, 60) * 1000).toISOString()}`));
});
