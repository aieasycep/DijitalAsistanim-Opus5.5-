import { assert, assertEquals } from '@std/assert';
import { FakeTime } from '@std/testing/time';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import { memoryJobsRepo } from '../testing/jobs.ts';
import { createRegistry, defineJob } from './registry.ts';
import { backoffSeconds, retryDelaySeconds, runWorker, toJobError } from './runner.ts';
import { JobError, type JobDefinition, type JobHandler } from './types.ts';

const T0 = Date.parse('2026-09-23T07:00:00Z');

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function registryWith(handler: JobHandler<{ n: number }>, timeoutMs = 5_000) {
  return createRegistry([
    defineJob({
      type: 'notification',
      payload: z.strictObject({ n: z.number() }),
      handler,
      timeoutMs,
    }) as unknown as JobDefinition<never>,
  ]);
}

function quietLog() {
  const sink = memorySink();
  return { log: createLogger({ fn: 'worker', sink: sink.sink }), sink };
}

Deno.test(
  'backoff is full-jitter exponential (base 30 s, cap 1 h); Retry-After overrides it',
  () => {
    assertEquals(
      backoffSeconds(1, () => 0.999),
      30,
    );
    assertEquals(
      backoffSeconds(2, () => 0.999),
      60,
    );
    assertEquals(
      backoffSeconds(20, () => 0.9999999),
      3600,
    );
    assertEquals(
      backoffSeconds(20, () => 0.5),
      1800,
    );
    assertEquals(
      backoffSeconds(1, () => 0),
      1,
    );
    assertEquals(
      backoffSeconds(3, () => 0.5),
      60,
    );
    assertEquals(
      retryDelaySeconds(new JobError('X', true, 90), 1, () => 0.5),
      90,
    );
    assertEquals(retryDelaySeconds(new JobError('X', false), 1), null);
    assertEquals(
      toJobError(new AppError('PROVIDER_RATE_LIMITED', { headers: { 'Retry-After': '42' } }), false)
        .retryAfterSeconds,
      42,
    );
    assertEquals(toJobError(new TypeError('boom'), false).code, 'HANDLER_ERROR');
    assertEquals(toJobError(new Error('x'), true).code, 'UPSTREAM_TIMEOUT');
  },
);

Deno.test(
  'a failing handler is retried with backoff and dead-lettered after max_attempts',
  async () => {
    const c = clock();
    const repo = memoryJobsRepo(c.now);
    let calls = 0;
    const registry = registryWith(() => {
      calls++;
      return Promise.reject(new JobError('PROVIDER_UNAVAILABLE', true));
    });
    const { log } = quietLog();
    const id = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'notification:1',
      payload: { n: 1 },
      maxAttempts: 3,
    });

    const first = await runWorker({
      repo,
      registry,
      log,
      now: c.now,
      random: () => 0.5,
      workerId: 'w1',
    });
    assertEquals({ claimed: first.claimed, retried: first.retried }, { claimed: 1, retried: 1 });
    const job = repo.jobs.get(id);
    assertEquals(job?.status, 'retrying');
    assertEquals(job?.run_after, new Date(T0 + 15_000).toISOString());
    assertEquals(repo.failCalls[0]?.retryAfterSeconds, 15);

    const early = await runWorker({ repo, registry, log, now: c.now, workerId: 'w1' });
    assertEquals(early.claimed, 0);

    c.advance(15_000);
    const second = await runWorker({
      repo,
      registry,
      log,
      now: c.now,
      random: () => 0.5,
      workerId: 'w1',
    });
    assertEquals(second.retried, 1);
    assertEquals(repo.failCalls[1]?.retryAfterSeconds, 30);

    c.advance(30_000);
    const third = await runWorker({
      repo,
      registry,
      log,
      now: c.now,
      random: () => 0.5,
      workerId: 'w1',
    });
    assertEquals(third.dead_lettered, 1);
    assertEquals(repo.jobs.get(id)?.status, 'dead_letter');
    assertEquals(calls, 3);
    assertEquals(
      repo.attempts.map((a) => [a.attempt, a.outcome, a.errorCode]),
      [
        [1, 'failed', 'PROVIDER_UNAVAILABLE'],
        [2, 'failed', 'PROVIDER_UNAVAILABLE'],
        [3, 'failed', 'PROVIDER_UNAVAILABLE'],
      ],
    );
  },
);

Deno.test(
  'non-retryable failures end as failed; poison payloads never reach the handler',
  async () => {
    const c = clock();
    const repo = memoryJobsRepo(c.now);
    let calls = 0;
    const registry = registryWith(() => {
      calls++;
      return Promise.reject(new JobError('ENTITLEMENT_REQUIRED', false));
    });
    const { log } = quietLog();
    const business = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'n:business',
      payload: { n: 1 },
    });
    const poison = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'n:poison',
      payload: { n: 'not-a-number' },
    });
    const summary = await runWorker({ repo, registry, log, now: c.now });
    assertEquals(summary.failed, 2);
    assertEquals(repo.jobs.get(business)?.status, 'failed');
    assertEquals(repo.jobs.get(poison)?.status, 'failed');
    assertEquals(repo.jobs.get(poison)?.last_error_code, 'POISON_PAYLOAD');
    assertEquals(calls, 1);
    assert(repo.failCalls.every((f) => f.retryAfterSeconds === null && !f.retryable));
  },
);

Deno.test('a handler past its timeout is aborted and retried as UPSTREAM_TIMEOUT', async () => {
  const c = clock();
  const repo = memoryJobsRepo(c.now);
  let aborted = false;
  const registry = registryWith(
    (ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true;
          reject(ctx.signal.reason);
        });
      }),
    20,
  );
  const { log } = quietLog();
  const id = await repo.enqueue({
    type: 'notification',
    idempotencyKey: 'n:slow',
    payload: { n: 1 },
  });
  const summary = await runWorker({ repo, registry, log, now: c.now, random: () => 0.1 });
  assertEquals(summary.retried, 1);
  assert(aborted);
  assertEquals(repo.jobs.get(id)?.last_error_code, 'UPSTREAM_TIMEOUT');
  assertEquals(repo.failCalls[0]?.retryable, true);
});

Deno.test(
  'lease reclaim: a reclaimed job completes once and the late result is discarded as LEASE_LOST',
  async () => {
    const c = clock();
    const repo = memoryJobsRepo(c.now);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completedBy: string[] = [];
    let calls = 0;
    const registry = registryWith(async (ctx) => {
      calls++;
      if (calls === 1) await gate;
      completedBy.push(ctx.workerId);
      return { by: ctx.workerId };
    });
    const { log, sink } = quietLog();
    const id = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'n:lease',
      payload: { n: 1 },
    });

    const stuck = runWorker({ repo, registry, log, now: c.now, workerId: 'worker-a' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assertEquals(repo.jobs.get(id)?.lease_owner, 'worker-a');

    c.advance(121_000);
    assertEquals(repo.reapExpiredLeases(), 1);
    assertEquals(repo.jobs.get(id)?.status, 'retrying');
    const rescue = await runWorker({ repo, registry, log, now: c.now, workerId: 'worker-b' });
    assertEquals(rescue.completed, 1);

    release();
    const late = await stuck;
    assertEquals(late.lease_lost, 1);
    assertEquals(late.completed, 0);
    const job = repo.jobs.get(id);
    assertEquals(job?.status, 'completed');
    assertEquals(job?.result, { by: 'worker-b' });
    assertEquals(job?.attempts, 2);
    assert(sink.records().some((r) => r.msg === 'job_lease_lost' && r.job_id === id));
  },
);

Deno.test('long jobs extend their lease on the heartbeat', async () => {
  const time = new FakeTime(T0);
  try {
    const repo = memoryJobsRepo(() => Date.now());
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = registryWith(async () => {
      await gate;
      return null;
    }, 300_000);
    const { log } = quietLog();
    const id = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'n:long',
      payload: { n: 1 },
    });
    const run = runWorker({ repo, registry, log, workerId: 'w' });
    await time.tickAsync(1);
    const initialExpiry = repo.jobs.get(id)?.lease_expires_at;
    await time.tickAsync(60_000);
    const extended = repo.jobs.get(id)?.lease_expires_at;
    assert(
      initialExpiry !== undefined &&
        extended !== undefined &&
        Date.parse(extended ?? '') > Date.parse(initialExpiry ?? ''),
    );
    release();
    await time.runMicrotasks();
    const summary = await run;
    assertEquals(summary.completed, 1);
  } finally {
    time.restore();
  }
});

Deno.test('the wall-clock budget stops new claims; max_jobs caps the run', async () => {
  const c = clock();
  const repo = memoryJobsRepo(c.now);
  const registry = registryWith(() => {
    c.advance(6_000);
    return Promise.resolve(null);
  });
  const { log } = quietLog();
  for (let i = 0; i < 12; i++)
    await repo.enqueue({ type: 'notification', idempotencyKey: `n:${i}`, payload: { n: i } });
  const budgeted = await runWorker({ repo, registry, log, now: c.now, budgetMs: 15_000 });
  assertEquals(budgeted.claimed, 5);
  assertEquals(budgeted.completed, 5);
  const capped = await runWorker({ repo, registry, log, now: c.now, maxJobs: 2 });
  assertEquals(capped.claimed, 2);
});

Deno.test(
  'the correlation id is on every log line and inherited by follow-up jobs; progress is persisted',
  async () => {
    const c = clock();
    const repo = memoryJobsRepo(c.now);
    const correlationId = '7b0c8f0e-3a1d-4d2e-9f5b-0c1d2e3f4a5b';
    const registry = registryWith(async (ctx) => {
      ctx.log.info('handler_step');
      await ctx.progress({ step: 1 });
      await ctx.enqueue({
        type: 'notification',
        idempotencyKey: `follow:${ctx.job.id}`,
        payload: { n: 2 },
      });
      return { ok: true };
    });
    const { log, sink } = quietLog();
    const id = await repo.enqueue({
      type: 'notification',
      idempotencyKey: 'n:root',
      payload: { n: 1 },
      correlationId,
    });
    await runWorker({ repo, registry, log, now: c.now, maxJobs: 1 });
    const followUp = repo.byKey(`follow:${id}`);
    assertEquals(followUp?.correlation_id, correlationId);
    assertEquals(repo.jobs.get(id)?.progress, { step: 1 });
    const lines = sink.records().filter((r) => r.job_id === id);
    assert(lines.length >= 2);
    assert(lines.every((r) => r.correlation_id === correlationId));
  },
);

Deno.test('a duplicate enqueue returns the existing job and creates no second job', async () => {
  const repo = memoryJobsRepo();
  const a = await repo.enqueue({
    type: 'notification',
    idempotencyKey: 'notification:u1:2026-09-23',
    payload: { n: 1 },
  });
  const b = await repo.enqueue({
    type: 'notification',
    idempotencyKey: 'notification:u1:2026-09-23',
    payload: { n: 2 },
  });
  assertEquals(a, b);
  assertEquals(repo.jobs.size, 1);
  assertEquals(repo.jobs.get(a)?.payload, { n: 1 });
});

Deno.test('job types without a registered handler are never claimed', async () => {
  const repo = memoryJobsRepo();
  const registry = registryWith(() => Promise.resolve(null));
  const { log } = quietLog();
  await repo.enqueue({ type: 'gmail_sync', idempotencyKey: 'g:1' });
  const summary = await runWorker({ repo, registry, log, types: ['gmail_sync'] });
  assertEquals(summary.claimed, 0);
  assertEquals(repo.byKey('g:1')?.status, 'queued');
});
