/**
 * JOB-26 `health_check` through the job runner (API_CONTRACTS §11.4, §14 HLT-02; TEST_PLAN
 * TST-BO-06 "real health checks"): a queued job is claimed and completed, the probe rows land with
 * `checked_by = 'cron'`, a missing credential is never green, a backlog bucket is skipped without
 * probing, a `down` component reaches Sentry, and the worker claims every type the `cron` probe
 * measures queue lag over.
 */
import { assert, assertEquals } from '@std/assert';
import { WORKER_JOB_TYPES } from '../../_shared/jobs/worker-types.ts';
import { runWorker } from '../../_shared/jobs/runner.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import type { Sentry, SentryEventContext } from '../../_shared/observability/sentry.ts';
import { testEnv } from '../../_shared/testing/env.ts';
import { stubFetch } from '../../_shared/testing/fetch.ts';
import { memoryJobsRepo } from '../../_shared/testing/jobs.ts';
import type { HealthRow } from '../../health/data.ts';
import type { HealthData } from '../../health/probes/types.ts';
import { HEALTH_CHECK_STALE_MS, healthCheckJob, type HealthCheckJobDeps } from './health_check.ts';
import { createHandlerRegistry, jobDefinitions } from './index.ts';

const NOW = Date.parse('2026-09-28T07:00:00Z');

function data(overrides: Partial<HealthData> = {}): HealthData {
  return {
    pingDatabase: () => Promise.resolve(),
    listStorage: () => Promise.resolve(),
    cronStats: () =>
      Promise.resolve({
        lastAttemptFinishedAt: new Date(NOW - 10_000).toISOString(),
        oldestReadyJobAt: null,
        lastCronEnqueueAt: new Date(NOW - 60_000).toISOString(),
      }),
    webhookStats: () =>
      Promise.resolve({ lastReceivedAt: null, total: 0, rejected: 0, backlog: 0 }),
    aiErrorRate: () => Promise.resolve({ total: 0, errors: 0 }),
    accountHealth: () => Promise.resolve({ total: 0, failing: 0 }),
    embeddingQueryModel: () => Promise.resolve(null),
    googleOauth: () => Promise.resolve({ setting: false, gmailUsers: 0 }),
    auditChain: () => Promise.resolve({ ok: true, checked: 3, firstBadSeq: null }),
    ...overrides,
  };
}

function setup(overrides: Partial<HealthCheckJobDeps> = {}) {
  const jobs = memoryJobsRepo(() => NOW);
  const rows: HealthRow[] = [];
  const captured: { error: unknown; context: SentryEventContext }[] = [];
  const sentry: Sentry = {
    enabled: true,
    captureException: (error, context) => Promise.resolve(void captured.push({ error, context })),
  };
  const stub = stubFetch((call) =>
    call.url.endsWith('/auth/v1/health') || call.url.endsWith('/health/live')
      ? new Response('{}', { status: 200 })
      : new Response('unexpected', { status: 599 }),
  );
  const deps: HealthCheckJobDeps = {
    raw: testEnv(),
    data: data(),
    writer: { insert: (r) => Promise.resolve(void rows.push(...r)) },
    fetch: stub.fetch,
    sentry,
    ...overrides,
  };
  const registry = createHandlerRegistry({
    credentials: {} as never,
    keyring: () => Promise.reject(new Error('unused')),
    business: { billing: {} as never, referrals: {} as never },
    health: deps,
  });
  const run = () =>
    runWorker({
      repo: jobs,
      registry,
      log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      types: ['health_check'],
      now: () => NOW,
      random: () => 0.5,
    });
  return { jobs, rows, captured, run };
}

Deno.test(
  'JOB-26: a queued health_check job is claimed, probes run in-process and the job completes',
  async () => {
    const { jobs, rows, run } = setup();
    await jobs.enqueue({ type: 'health_check', idempotencyKey: 'health:202609280700' });
    const summary = await run();
    assertEquals(summary.claimed, 1);
    assertEquals(summary.completed, 1);
    const job = jobs.byKey('health:202609280700');
    assertEquals(job?.status, 'completed');
    assert(rows.length >= 15, `expected a row per persisted component, got ${rows.length}`);
    assert(rows.every((r) => r.checked_by === 'cron'));
    const byComponent = new Map(rows.map((r) => [r.component, r]));
    assertEquals(byComponent.get('database')?.status, 'healthy');
    assertEquals(byComponent.get('cron')?.status, 'healthy');
    // No provider credential in the test env: never a fake green.
    for (const component of ['google_oauth', 'microsoft_oauth', 'push', 'revenuecat']) {
      assertEquals(byComponent.get(component)?.status, 'external_credential_required', component);
    }
    const result = job?.result as Record<string, number>;
    assertEquals(result.written, rows.length);
    assert(result.external_credential_required > 0);
  },
);

Deno.test('JOB-26: a payload probe selection runs only those probes', async () => {
  const { jobs, rows, run } = setup();
  await jobs.enqueue({
    type: 'health_check',
    idempotencyKey: 'health:selected',
    payload: { probes: ['database', 'cron'] },
  });
  await run();
  assertEquals(rows.map((r) => r.component).sort(), ['cron', 'database']);
});

Deno.test(
  'JOB-26: a backlog bucket older than two cadences completes without probing',
  async () => {
    const { jobs, rows, run } = setup();
    await jobs.enqueue({
      type: 'health_check',
      idempotencyKey: 'health:stale',
      runAfter: new Date(NOW - HEALTH_CHECK_STALE_MS - 60_000),
    });
    const summary = await run();
    assertEquals(summary.completed, 1);
    assertEquals(rows.length, 0);
    assertEquals((jobs.byKey('health:stale')?.result as Record<string, unknown>).skipped, 'stale');
  },
);

Deno.test('JOB-26: a down component raises a Sentry event without failing the job', async () => {
  const { jobs, captured, run } = setup({
    data: data({ pingDatabase: () => Promise.reject(new Error('connection refused')) }),
  });
  await jobs.enqueue({ type: 'health_check', idempotencyKey: 'health:down' });
  const summary = await run();
  assertEquals(summary.completed, 1);
  assertEquals(captured.length, 1);
  assertEquals(captured[0]?.context.code, 'HEALTH_OUTAGE');
  assert(String((captured[0]?.error as Error).message).includes('database'));
});

Deno.test('JOB-26: a failed insert retries the job', async () => {
  const { jobs, run } = setup({
    writer: { insert: () => Promise.reject(new Error('insert failed')) },
  });
  await jobs.enqueue({ type: 'health_check', idempotencyKey: 'health:retry', maxAttempts: 2 });
  const summary = await run();
  assertEquals(summary.retried, 1);
  assertEquals(jobs.byKey('health:retry')?.status, 'retrying');
});

Deno.test('the cron probe measures lag only over types the production worker claims', () => {
  const types = new Set(
    jobDefinitions({
      credentials: {} as never,
      keyring: () => Promise.reject(new Error('unused')),
      notifications: {} as never,
      approvals: {} as never,
      business: { billing: {} as never, referrals: {} as never },
      integrations: {} as never,
      intel: {} as never,
      email: {} as never,
      privacy: {} as never,
      assist: {} as never,
      health: {} as never,
      aiEval: {} as never,
    }).map((d) => d.type),
  );
  assertEquals([...types].sort(), [...WORKER_JOB_TYPES].sort());
  assert(types.has('health_check'));
  assert(types.has('ai_eval'), 'ai_eval has a worker definition');
});

Deno.test('healthCheckJob uses the JOB-26 timeout from the registry', () => {
  const def = healthCheckJob({} as never);
  assertEquals(def.type, 'health_check');
  assertEquals(def.timeoutMs, 30_000);
});
