/**
 * IT-JOB-26 (API_CONTRACTS JOB-26 `health_check`, §14 HLT-02): the job `da_health_check` enqueues
 * every 5 minutes is claimed by the real worker entrypoint, runs the System Health probes
 * in-process, writes `system_health_checks` rows with `checked_by = 'cron'` and completes; the
 * `cron` probe's queue lag ignores job types no worker claims, and a backlog bucket is drained
 * without probing.
 */
import { assert, assertEquals } from '@std/assert';
import { call, count, env, it, json, one, q } from './_harness/mod.ts';

async function enqueueHealth(key: string, runAfter = 'now()'): Promise<string> {
  const row = await one<{ id: string }>(
    `select public.enqueue_job('health_check'::public.job_type, $1, '{}'::jsonb, null, null, ${runAfter}) as id`,
    [key],
  );
  return row.id;
}

async function runWorker(): Promise<Record<string, number>> {
  const res = await call('worker', 'POST', '/run', {
    headers: { apikey: env('CRON_SECRET') },
    body: { types: ['health_check'], max_jobs: 5, budget_ms: 60000 },
  });
  const out = await json<{ data: Record<string, number> }>(res);
  assertEquals(res.status, 200, JSON.stringify(out));
  return out.data;
}

it(
  'IT-JOB-26',
  'a queued health_check job is claimed, writes probe rows and completes',
  async () => {
    await q(`delete from public.system_health_checks`);
    const id = await enqueueHealth(`health:it:${crypto.randomUUID()}`);
    // A due job of a type no worker claims must not count as queue lag.
    await q(
      `select public.enqueue_job('ai_eval'::public.job_type, $1, '{}'::jsonb, null, null, now() - interval '30 minutes')`,
      [`ai_eval:it:${crypto.randomUUID()}`],
    );

    const summary = await runWorker();
    assertEquals(summary.claimed, 1);
    assertEquals(summary.completed, 1);

    const job = await one<{
      status: string;
      correlation_id: string;
      result: Record<string, number>;
    }>(`select status, correlation_id::text, result from public.jobs where id = $1`, [id]);
    assertEquals(job.status, 'completed');
    assert(job.result.written > 0, JSON.stringify(job.result));

    const rows = await q<{
      component: string;
      status: string;
      checked_by: string;
      detail: Record<string, unknown>;
    }>(`select component, status::text, checked_by, detail from public.system_health_checks`);
    assertEquals(rows.length, job.result.written);
    assert(rows.every((r) => r.checked_by === 'cron'));
    assert(rows.every((r) => r.detail.correlation_id === job.correlation_id));
    const byComponent = new Map(rows.map((r) => [r.component, r]));
    assertEquals(byComponent.get('database')?.status, 'healthy');
    const cron = byComponent.get('cron');
    assert(cron !== undefined);
    // Only the unclaimed `ai_eval` job was due: the lag stays zero and the probe is not down.
    assertEquals(cron.detail.queue_lag_s, 0, JSON.stringify(cron.detail));
    assert(cron.status !== 'down', JSON.stringify(cron));
    // The unclaimed type stays queued; nothing else is left for the worker.
    assertEquals(
      await count(
        `select 1 from public.jobs where type = 'health_check' and status <> 'completed'`,
      ),
      0,
    );
  },
);

it('IT-JOB-26', 'a backlog health_check bucket completes as stale without probing', async () => {
  await q(`delete from public.system_health_checks`);
  const id = await enqueueHealth(
    `health:it:stale:${crypto.randomUUID()}`,
    `now() - interval '45 minutes'`,
  );
  const summary = await runWorker();
  assertEquals(summary.completed, 1);
  const job = await one<{ status: string; result: Record<string, unknown> }>(
    `select status, result from public.jobs where id = $1`,
    [id],
  );
  assertEquals(job.status, 'completed');
  assertEquals(job.result.skipped, 'stale');
  assertEquals(await count(`select 1 from public.system_health_checks`), 0);
});
