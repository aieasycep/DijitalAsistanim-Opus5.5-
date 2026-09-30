import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
import { errorEnvelopeSchema } from '@da/validation';
import { AppError } from '../errors.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import type { Sentry } from '../observability/sentry.ts';
import { createApp } from './app.ts';
import { sendData } from './respond.ts';

function setup(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const mem = memorySink();
  const captured: unknown[] = [];
  const sentry: Sentry = {
    enabled: true,
    captureException: (error) => {
      captured.push(error);
      return Promise.resolve();
    },
  };
  const app = createApp({
    fn: 'api',
    logger: createLogger({ fn: 'api', sink: mem.sink }),
    sentry,
    ...options,
  });
  app.post('/echo', async (c) => sendData(c, { size: (await c.req.text()).length }));
  app.get('/boom', () => {
    throw new TypeError('database password=hunter2');
  });
  app.get('/forbidden', () => {
    throw new AppError('FORBIDDEN', { details: { reason: 'x' } });
  });
  return { app, mem, captured };
}

Deno.test(
  'unknown routes answer the NOT_FOUND envelope; a valid correlation id is echoed',
  async () => {
    const { app } = setup();
    const res = await app.request('/api/nope', {
      headers: { 'X-Correlation-Id': 'corr-12345678' },
    });
    assertEquals(res.status, 404);
    assertEquals(res.headers.get('X-Correlation-Id'), 'corr-12345678');
    assert(res.headers.get('X-Request-Id') !== null);
    const body = await res.json();
    assert(errorEnvelopeSchema.safeParse(body).success);
    assertEquals(body.error.code, 'NOT_FOUND');
    assertEquals(body.error.correlation_id, 'corr-12345678');
  },
);

Deno.test('an invalid correlation id is replaced by a generated one', async () => {
  const { app } = setup();
  const res = await app.request('/api/nope', { headers: { 'X-Correlation-Id': 'bad id!' } });
  assertMatch(res.headers.get('X-Correlation-Id') ?? '', /^[0-9a-f-]{36}$/);
  await res.body?.cancel();
});

Deno.test(
  'AppError renders its status and envelope; responses are no-store and nosniff',
  async () => {
    const { app } = setup();
    const res = await app.request('/api/forbidden', { headers: { 'Accept-Language': 'en-US' } });
    assertEquals(res.status, 403);
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
    assertEquals(res.headers.get('X-Content-Type-Options'), 'nosniff');
    const body = await res.json();
    assertEquals(body.error.code, 'FORBIDDEN');
    assertEquals(body.error.details, { reason: 'x' });
  },
);

Deno.test(
  'unhandled errors become INTERNAL_ERROR, reach Sentry, and never leak their message',
  async () => {
    const { app, captured, mem } = setup();
    const res = await app.request('/api/boom');
    assertEquals(res.status, 500);
    const text = await res.text();
    assertFalse(text.includes('hunter2'));
    assertEquals(JSON.parse(text).error.code, 'INTERNAL_ERROR');
    assertEquals(captured.length, 1);
    assert(mem.records().some((r) => r.msg === 'unhandled_error'));
  },
);

Deno.test('bodies over 1 MB are refused with PAYLOAD_TOO_LARGE', async () => {
  const { app } = setup();
  const res = await app.request('/api/echo', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
  assertEquals(res.status, 413);
  assertEquals((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

Deno.test('the request log carries route, status and duration but never the body', async () => {
  const { app, mem } = setup();
  const res = await app.request('/api/echo', { method: 'POST', body: 'secret-body-content' });
  await res.body?.cancel();
  const line = mem.lines.find((l) => l.includes('"msg":"request"')) ?? '';
  assert(line !== '');
  assertFalse(line.includes('secret-body-content'));
  const record = JSON.parse(line);
  assertEquals(record.status, 200);
  assert(typeof record.duration_ms === 'number');
});

Deno.test('browser origins are refused where the function is native/server-only', async () => {
  const { app } = setup({ rejectBrowserOrigin: true });
  const res = await app.request('/api/echo', {
    method: 'POST',
    body: '{}',
    headers: { Origin: 'https://evil.example' },
  });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.details.reason, 'browser_origin');
});

Deno.test('CORS headers are sent only to the configured web origin', async () => {
  const { app } = setup({ fn: 'public-api', cors: { origins: ['https://dijitalasistan.app'] } });
  const ok = await app.request('/public-api/nope', {
    headers: { Origin: 'https://dijitalasistan.app' },
  });
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), 'https://dijitalasistan.app');
  await ok.body?.cancel();
  const other = await app.request('/public-api/nope', {
    headers: { Origin: 'https://evil.example' },
  });
  assertEquals(other.headers.get('Access-Control-Allow-Origin'), null);
  await other.body?.cancel();
});
