import { assert, assertEquals } from '@std/assert';
import { AppError } from './errors.ts';
import { createApp } from './http/app.ts';
import type { UserAuth } from './http/context.ts';
import { parseJsonBody } from './http/validate.ts';
import {
  canonicalJson,
  memoryIdempotencyRepo,
  requestFingerprint,
  supabaseIdempotencyRepo,
  withIdempotency,
} from './idempotency.ts';
import { createLogger, memorySink } from './logging/logger.ts';
import { jsonResponse, stubFetch } from './testing/fetch.ts';
import { testDb } from './testing/db.ts';
import { routes } from '@da/validation';

const USER = '11111111-1111-4111-8111-111111111111';
const KEY = '5f0e3d6a-8c1b-4b7e-9a51-2f4c9e7d1a10';

function setup(execute: () => Promise<{ data: unknown; ref: { type: string; id?: string } }>) {
  const repo = memoryIdempotencyRepo();
  let executions = 0;
  const app = createApp({
    fn: 'api',
    logger: createLogger({ fn: 'api', sink: memorySink().sink }),
  });
  const route = routes['POST /feedback'];
  app.post(
    '/feedback',
    async (c, next) => {
      c.set('auth', {
        userId: USER,
        aal: 'aal1',
        sessionId: null,
        jwt: 'x',
        claims: { sub: USER },
      } satisfies UserAuth);
      c.set('routeKey', 'POST /feedback');
      await next();
    },
    parseJsonBody(route),
    (c) =>
      withIdempotency(
        c,
        { repo },
        {
          status: 201,
          execute: () => {
            executions++;
            return execute();
          },
          replay: (ref) => Promise.resolve({ id: ref.id, replayed_from_store: true }),
        },
      ),
  );
  const call = (body: unknown, key: string | null = KEY) =>
    app.request('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key === null ? {} : { 'Idempotency-Key': key }),
      },
      body: JSON.stringify(body),
    });
  return { app, repo, call, executions: () => executions };
}

Deno.test('a replayed key returns the original response and runs no second write', async () => {
  const { call, executions } = setup(() =>
    Promise.resolve({ data: { id: 'f1' }, ref: { type: 'user_feedback', id: 'f1' } }),
  );
  const first = await call({ type: 'bug', rating: 3 });
  assertEquals(first.status, 201);
  assertEquals((await first.json()).data, { id: 'f1' });
  const replay = await call({ rating: 3, type: 'bug' });
  assertEquals(replay.status, 201);
  assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
  const body = await replay.json();
  assertEquals(body.data, { id: 'f1', replayed_from_store: true });
  assertEquals(body.meta.idempotency_replayed, true);
  assertEquals(executions(), 1);
});

Deno.test(
  'the same key with a different body is IDEMPOTENCY_REPLAY fingerprint_mismatch',
  async () => {
    const { call } = setup(() =>
      Promise.resolve({ data: { id: 'f1' }, ref: { type: 'user_feedback', id: 'f1' } }),
    );
    await (await call({ type: 'bug', rating: 3 })).body?.cancel();
    const res = await call({ type: 'bug', rating: 4 });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error.code, 'IDEMPOTENCY_REPLAY');
    assertEquals(body.error.details.reason, 'fingerprint_mismatch');
  },
);

Deno.test('a key still in progress answers 409 in_progress with Retry-After: 1', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { call } = setup(async () => {
    await gate;
    return { data: { id: 'f1' }, ref: { type: 'user_feedback', id: 'f1' } };
  });
  const first = call({ type: 'bug', rating: 3 });
  await new Promise((r) => setTimeout(r, 5));
  const second = await call({ type: 'bug', rating: 3 });
  assertEquals(second.status, 409);
  assertEquals(second.headers.get('Retry-After'), '1');
  const body = await second.json();
  assertEquals(body.error.details.reason, 'in_progress');
  assertEquals(body.error.retryable, true);
  release();
  await (await first).body?.cancel();
});

Deno.test(
  'deterministic 4xx failures are stored and replayed; retryable failures free the key',
  async () => {
    let attempt = 0;
    const deterministic = setup(() =>
      Promise.reject(new AppError('ENTITLEMENT_REQUIRED', { details: { feature: 'capture' } })),
    );
    const a = await deterministic.call({ type: 'bug' });
    assertEquals(a.status, 402);
    await a.body?.cancel();
    const b = await deterministic.call({ type: 'bug' });
    assertEquals(b.status, 402);
    assertEquals(b.headers.get('Idempotency-Replayed'), 'true');
    assertEquals((await b.json()).error.details, { feature: 'capture' });
    assertEquals(deterministic.executions(), 1);

    const flaky = setup(() => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new AppError('PROVIDER_UNAVAILABLE'))
        : Promise.resolve({ data: { id: 'f2' }, ref: { type: 'user_feedback', id: 'f2' } });
    });
    const first = await flaky.call({ type: 'bug' });
    assertEquals(first.status, 502);
    await first.body?.cancel();
    const retry = await flaky.call({ type: 'bug' });
    assertEquals(retry.status, 201);
    assertEquals((await retry.json()).data, { id: 'f2' });
    assertEquals(flaky.executions(), 2);
  },
);

Deno.test('a missing or non-UUID Idempotency-Key is a validation error', async () => {
  const { call, executions } = setup(() => Promise.resolve({ data: {}, ref: { type: 'x' } }));
  for (const key of [null, 'not-a-uuid']) {
    const res = await call({ type: 'bug' }, key);
    assertEquals(res.status, 422);
    assertEquals((await res.json()).error.field_errors[0].path, 'headers.Idempotency-Key');
  }
  assertEquals(executions(), 0);
});

Deno.test('fingerprints ignore key order and include method + route', async () => {
  assertEquals(
    canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }),
    '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}',
  );
  const a = await requestFingerprint('POST', 'POST /feedback', { a: 1, b: 2 });
  const b = await requestFingerprint('post', 'POST /feedback', { b: 2, a: 1 });
  const c = await requestFingerprint('POST', 'POST /support/tickets', { a: 1, b: 2 });
  assertEquals(a, b);
  assert(a.some((byte, i) => byte !== c[i]));
  assertEquals(a.byteLength, 32);
});

Deno.test(
  'supabase repository: insert-if-absent upsert, bytea fingerprint, completion update',
  async () => {
    const stub = stubFetch((call) => {
      if (call.method === 'POST') return jsonResponse([{ key: KEY }], 201);
      return jsonResponse([], 200);
    });
    const client = testDb(stub.fetch);
    const repo = supabaseIdempotencyRepo(client);
    const fingerprint = new Uint8Array(32).fill(0xab);
    const inserted = await repo.insert({
      userId: USER,
      key: KEY,
      route: 'POST /feedback',
      fingerprint,
      state: 'in_progress',
      responseStatus: null,
      resourceRef: null,
      expiresAt: '2026-09-24T07:00:00.000Z',
    });
    assert(inserted);
    const insert = stub.calls[0];
    assert(insert !== undefined);
    assert(insert.url.includes('/rest/v1/api_idempotency_keys'));
    assert(decodeURIComponent(insert.url).includes('on_conflict=user_id,key'));
    assert((insert.headers.get('Prefer') ?? '').includes('resolution=ignore-duplicates'));
    const row = JSON.parse(insert.body ?? '{}');
    assertEquals(row.fingerprint, `\\x${'ab'.repeat(32)}`);
    assertEquals(row.state, 'in_progress');
    await repo.complete(USER, KEY, 201, { type: 'user_feedback', id: 'f1' });
    const update = stub.calls[1];
    assertEquals(update?.method, 'PATCH');
    assertEquals(JSON.parse(update?.body ?? '{}'), {
      state: 'completed',
      response_status: 201,
      resource_ref: { type: 'user_feedback', id: 'f1' },
    });
  },
);
