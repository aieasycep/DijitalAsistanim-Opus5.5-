import { assertEquals } from '@std/assert';
import { z } from 'zod';
import { createRegistry, defineJob } from '../_shared/jobs/registry.ts';
import type { JobDefinition } from '../_shared/jobs/types.ts';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import { memoryJobsRepo } from '../_shared/testing/jobs.ts';
import { createWorkerApp } from './app.ts';

function setup() {
  const secret = crypto.randomUUID();
  const repo = memoryJobsRepo();
  const registry = createRegistry([
    defineJob({
      type: 'notification',
      payload: z.strictObject({}),
      handler: () => Promise.resolve({ sent: true }),
    }) as unknown as JobDefinition<never>,
  ]);
  const app = createWorkerApp({
    secret,
    repo,
    registry,
    log: createLogger({ fn: 'worker', sink: memorySink().sink }),
  });
  return { app, repo, secret };
}

Deno.test('POST /worker/run without the automations secret is 401 AUTH_REQUIRED', async () => {
  const { app } = setup();
  for (const headers of [{}, { apikey: 'wrong' }, { Authorization: 'Bearer wrong' }] as Record<
    string,
    string
  >[]) {
    const res = await app.request('/worker/run', { method: 'POST', headers, body: '{}' });
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error.code, 'AUTH_REQUIRED');
  }
});

Deno.test('POST /worker/run drains claimable jobs and reports the summary', async () => {
  const { app, repo, secret } = setup();
  await repo.enqueue({ type: 'notification', idempotencyKey: 'n:1' });
  await repo.enqueue({ type: 'notification', idempotencyKey: 'n:2' });
  const res = await app.request('/worker/run', {
    method: 'POST',
    headers: { apikey: secret },
    body: '',
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    {
      claimed: body.data.claimed,
      completed: body.data.completed,
      retried: body.data.retried,
      failed: body.data.failed,
      dead_lettered: body.data.dead_lettered,
    },
    { claimed: 2, completed: 2, retried: 0, failed: 0, dead_lettered: 0 },
  );
  assertEquals(typeof body.data.duration_ms, 'number');
  assertEquals(repo.byKey('n:1')?.status, 'completed');
});

Deno.test(
  'POST /worker/run validates its body (422) and rejects malformed JSON (400)',
  async () => {
    const { app, secret } = setup();
    const bad = await app.request('/worker/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_jobs: 0, types: ['not_a_type'], extra: true }),
    });
    assertEquals(bad.status, 422);
    assertEquals((await bad.json()).error.code, 'VALIDATION_FAILED');
    const malformed = await app.request('/worker/run', {
      method: 'POST',
      headers: { apikey: secret },
      body: '{',
    });
    assertEquals(malformed.status, 400);
    await malformed.body?.cancel();
  },
);

Deno.test('unknown worker routes answer the NOT_FOUND envelope', async () => {
  const { app, secret } = setup();
  const res = await app.request('/worker/jobs', { method: 'GET', headers: { apikey: secret } });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, 'NOT_FOUND');
});
