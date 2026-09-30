/**
 * IT-JOB-* (TEST_PLAN §6.8; API_CONTRACTS JOB-00 `worker`, §11; DATABASE_AND_RLS_PLAN §6.2 queue
 * functions, §6.6 `scheduler_tick`; ADR-04): claims, leases, retries, the wall-clock budget,
 * correlation and the scheduler over a simulated day.
 */
import { assert, assertEquals } from '@std/assert';
import {
  asAdmin,
  call,
  count,
  createUser,
  drain,
  env,
  it,
  mock,
  one,
  q,
  releaseJobs,
} from './_harness/mod.ts';
import { connect } from './_harness/flows.ts';
import { accountEmail, gmailPush, mailboxState, MAILBOX } from './_harness/sync.ts';

async function enqueue(
  type: string,
  key: string,
  payload: Record<string, unknown>,
  userId: string,
  maxAttempts = 5,
): Promise<string> {
  const row = await one<{ id: string }>(
    `select private.enqueue_job($1::public.job_type, $2, $3::text::jsonb, $4::uuid, null, now(), 100, $5, null) as id`,
    [type, key, JSON.stringify(payload), userId, maxAttempts],
  );
  return row.id;
}

/** A cheap job that always completes: an insight rebuild of an empty tasks scope. */
async function cheapJobs(n: number): Promise<string[]> {
  const user = await createUser();
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      await enqueue(
        'insight_refresh',
        `it-job:${user.id}:${i}`,
        { user_id: user.id, scope: 'tasks', reason: 'it' },
        user.id,
      ),
    );
  return ids;
}

async function workerRun(body: Record<string, unknown>): Promise<Record<string, number>> {
  const res = await call('worker', 'POST', '/run', {
    headers: { apikey: env('CRON_SECRET') },
    body,
  });
  const out = (await res.json()) as { data: Record<string, number> };
  assertEquals(res.status, 200, JSON.stringify(out));
  return out.data;
}

it(
  'IT-JOB-01',
  'two concurrent worker invocations over 100 queued jobs never claim a job twice',
  async () => {
    const ids = await cheapJobs(100);
    const [a, b] = await Promise.all([
      workerRun({
        types: ['insight_refresh'],
        max_jobs: 50,
        budget_ms: 60000,
        worker_id: 'it-worker-a',
      }),
      workerRun({
        types: ['insight_refresh'],
        max_jobs: 50,
        budget_ms: 60000,
        worker_id: 'it-worker-b',
      }),
    ]);
    assertEquals((a?.claimed ?? 0) + (b?.claimed ?? 0), 100);
    const attempts = await q<{ job_id: string; n: string }>(
      `select job_id, count(*) as n from public.job_attempts where job_id = any($1::uuid[]) group by job_id`,
      [ids],
    );
    assertEquals(attempts.length, 100);
    for (const r of attempts) assertEquals(Number(r.n), 1, r.job_id);
    assertEquals(
      await count(`select 1 from public.jobs where id = any($1::uuid[]) and status = 'completed'`, [
        ids,
      ]),
      100,
    );
    const workers = await q<{ worker_id: string }>(
      `select distinct worker_id from public.job_attempts where job_id = any($1::uuid[])`,
      [ids],
    );
    assertEquals(workers.map((w) => w.worker_id).sort(), ['it-worker-a', 'it-worker-b']);
  },
);

it(
  'IT-JOB-02',
  'a worker dying mid-job: the job is reclaimed after the lease and its attempt count grows',
  async () => {
    const [id] = await cheapJobs(1);
    const claimed = await q<{ id: string }>(
      `select id from public.claim_jobs('it-dead-worker', array['insight_refresh']::public.job_type[], 1, 30)`,
    );
    assertEquals(
      claimed.map((c) => c.id),
      [id],
    );
    // The lease is still live: another worker cannot take it.
    assertEquals((await workerRun({ types: ['insight_refresh'] })).claimed, 0);
    // 30 s later (time travel on the lease) the tick reaps it and a live worker completes it.
    await q(`update public.jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [
      id,
    ]);
    await q(`select private.scheduler_tick(now())`);
    await releaseJobs(`id = '${id}'`);
    assertEquals((await workerRun({ types: ['insight_refresh'] })).completed, 1);
    const job = await one<{ status: string; attempts: number }>(
      `select status, attempts from public.jobs where id = $1`,
      [id],
    );
    assertEquals(job.status, 'completed');
    assertEquals(job.attempts, 2);
    const outcomes = await q<{ outcome: string | null }>(
      `select outcome from public.job_attempts where job_id = $1 order by attempt`,
      [id],
    );
    assertEquals(outcomes.length, 2);
  },
);

it(
  'IT-JOB-03',
  'an always-failing handler backs off exponentially, dead-letters, and job_retry re-queues it',
  async () => {
    const user = await createUser();
    await mock.script(`GET /revenuecat/v2/projects/projintegration/*`, [
      { status: 503, body: { object: 'error', type: 'server_error' }, times: 100 },
    ]);
    const id = await enqueue(
      'billing_sync',
      `billing_sync:${user.id}:it`,
      { app_user_id: user.id, event_id: null, reason: 'admin' },
      user.id,
      4,
    );
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      await releaseJobs(`id = '${id}'`);
      const before = Date.now();
      await workerRun({ types: ['billing_sync'] });
      const job = await one<{ status: string; run_after: Date; attempts: number }>(
        `select status, run_after, attempts from public.jobs where id = $1`,
        [id],
      );
      if (attempt < 4) {
        assertEquals(job.status, 'retrying');
        delays.push((new Date(job.run_after).getTime() - before) / 1000);
      } else {
        assertEquals(job.status, 'dead_letter');
      }
    }
    // Exponential with jitter, capped at 1 h: attempt n waits at most least(3600, 30·2^(n−1)) × 1.2 s.
    delays.forEach((d, i) => {
      const cap = Math.min(3600, 30 * 2 ** i) * 1.2;
      assert(d > 0 && d <= cap + 1, `attempt ${i + 1}: ${d} s (cap ${cap})`);
    });
    const retried = await asAdmin<{ r: Record<string, unknown> }>(
      'operations',
      `select admin_api.job_retry($1, $2) as r`,
      [id, 'RevenueCat kesintisi bitti, yeniden deneniyor.'],
    );
    assert(retried.length === 1);
    const after = await one<{ status: string }>(`select status from public.jobs where id = $1`, [
      id,
    ]);
    assertEquals(after.status, 'queued');
  },
);

it(
  'IT-JOB-04',
  'the wall-clock budget stops claiming; in-flight jobs finish; no orphaned running rows',
  async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => createUser()));
    for (const u of users)
      await mock.revenuecat({
        op: 'customer',
        id: u.id,
        fixture: 'revenuecat/customer_v2_active.json',
      });
    await mock.script('GET /revenuecat/v2/projects/projintegration/customers/*', [
      { passthrough: true, delay_ms: 1500, times: 100 },
    ]);
    for (const u of users)
      await enqueue(
        'billing_sync',
        `billing_sync:${u.id}:budget`,
        { app_user_id: u.id, event_id: null, reason: 'admin' },
        u.id,
      );
    const started = Date.now();
    // budget 12 s: claiming stops 10 s before the end (a 2 s window), so only the first batch of 5
    // (each 1.5 s at the provider) is taken; those finish, the sixth stays queued.
    const summary = await workerRun({ types: ['billing_sync'], max_jobs: 50, budget_ms: 12000 });
    const elapsed = Date.now() - started;
    assert(summary.claimed !== undefined && summary.claimed < 6, JSON.stringify(summary));
    assert((summary.claimed ?? 0) >= 1, JSON.stringify(summary));
    assertEquals(summary.completed, summary.claimed);
    assert(elapsed < 20_000, `run took ${elapsed} ms`);
    assertEquals(
      await count(`select 1 from public.jobs where type = 'billing_sync' and status = 'running'`),
      0,
    );
    assertEquals(
      await count(`select 1 from public.jobs where type = 'billing_sync' and status = 'queued'`),
      6 - summary.claimed,
    );
  },
);

it(
  'IT-JOB-05',
  'the webhook correlation id threads sync → analysis → ai_requests → notification (correlation_trace)',
  async () => {
    const user = await createUser({ pro: true });
    const { accountId } = await connect(user, 'google', ['mail_read']);
    await releaseJobs();
    await drain();
    // Scheduled polls would read the new history first; only the push path runs here.
    await q(`delete from public.jobs where status in ('queued', 'retrying')`);
    // The canon mailbox arrives after the connect: its triage survivors reach the AI tiers.
    await mock.google({ op: 'mailbox', fixtures: [MAILBOX], history: true });
    const correlation = crypto.randomUUID();
    const { token } = await mock.google<{ token: string }>({
      op: 'pubsub_token',
      audience: env('GOOGLE_PUBSUB_PUSH_AUDIENCE'),
      email: env('GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT'),
    });
    const box = await mailboxState();
    const data = btoa(
      JSON.stringify({ emailAddress: await accountEmail(accountId), historyId: box.history_id }),
    );
    const push = await call('webhooks-google', 'POST', '/gmail', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlation,
      },
      rawBody: JSON.stringify({
        message: { data, messageId: crypto.randomUUID(), publishTime: new Date().toISOString() },
        subscription: 'projects/da-integration-test/subscriptions/gmail-push',
      }),
    });
    await push.body?.cancel();
    assertEquals(push.status, 204);
    await releaseJobs();
    await drain();
    const jobs = await q<{ type: string }>(
      `select type from public.jobs where correlation_id = $1`,
      [correlation],
    );
    const types = new Set(jobs.map((j) => j.type));
    assert(types.has('provider_webhook'), JSON.stringify([...types]));
    assert(
      types.has('email_triage') || types.has('email_analysis'),
      JSON.stringify(
        await q(
          `select type, correlation_id, idempotency_key, status, result from public.jobs where user_id = $1 order by created_at`,
          [user.id],
        ),
      ),
    );
    assert(
      (await count(`select 1 from public.ai_requests where correlation_id = $1`, [correlation])) >=
        1,
      JSON.stringify(
        await q(
          `select feature, status, correlation_id from public.ai_requests where user_id = $1`,
          [user.id],
        ),
      ),
    );
    const trace = await asAdmin<{ r: Record<string, unknown[]> }>(
      'operations',
      `select admin_api.correlation_trace($1) as r`,
      [correlation],
    );
    const text = JSON.stringify(trace[0]?.r ?? {});
    assert(text.includes('provider_webhook'), text.slice(0, 500));
  },
);

it(
  'IT-JOB-06',
  'scheduler_tick over a simulated weekend: Istanbul, Berlin across DST and a silent-Saturday user',
  async () => {
    const istanbul = await createUser({ timezone: 'Europe/Istanbul' });
    const berlin = await createUser({ timezone: 'Europe/Berlin' });
    const silent = await createUser({ timezone: 'Europe/Istanbul' });
    await q(
      `update public.user_preferences set briefing_weekdays = '{1,2,3,4,5,7}' where user_id = $1`,
      [silent.id],
    );
    const users = [istanbul.id, berlin.id, silent.id];
    // Saturday 24 and Sunday 25 October 2026 (Berlin leaves summer time on the 25th, 03:00 → 02:00).
    const from = Date.parse('2026-10-23T21:00:00Z');
    const to = Date.parse('2026-10-26T00:00:00Z');
    for (let t = from; t < to; t += 15 * 60_000)
      await q(`select private.scheduler_tick($1::timestamptz)`, [new Date(t).toISOString()]);
    // A repeated tick at the same instant is a no-op.
    await q(`select private.scheduler_tick($1::timestamptz)`, [
      new Date(to - 15 * 60_000).toISOString(),
    ]);
    const rows = await q<{ user_id: string; kind: string; local_date: string; n: string }>(
      `select user_id, kind::text as kind, local_date::text as local_date, count(*) as n from public.briefings
      where user_id = any($1::uuid[]) group by 1, 2, 3 order by 1, 3, 2`,
      [users],
    );
    for (const r of rows) assertEquals(Number(r.n), 1, JSON.stringify(r));
    const kinds = (id: string, date: string) =>
      rows
        .filter((r) => r.user_id === id && r.local_date === date)
        .map((r) => r.kind)
        .sort();
    // Weekend: morning only (weekend_morning_only), weekly review on Sunday.
    assertEquals(kinds(istanbul.id, '2026-10-24'), ['morning']);
    assertEquals(kinds(istanbul.id, '2026-10-25'), ['morning', 'weekly']);
    assertEquals(kinds(berlin.id, '2026-10-24'), ['morning']);
    assertEquals(kinds(berlin.id, '2026-10-25'), ['morning', 'weekly']);
    assertEquals(kinds(silent.id, '2026-10-24'), []);
    assertEquals(kinds(silent.id, '2026-10-25'), ['morning', 'weekly']);
    // Berlin's Sunday morning at 10:00 CET is 09:00Z (after the DST change), Istanbul's is 07:00Z.
    const at = async (id: string, date: string, kind: string) =>
      new Date(
        (
          await one<{ scheduled_for: Date }>(
            `select scheduled_for from public.briefings where user_id = $1 and local_date = $2 and kind = $3`,
            [id, date, kind],
          )
        ).scheduled_for,
      ).toISOString();
    assertEquals(await at(berlin.id, '2026-10-25', 'morning'), '2026-10-25T09:00:00.000Z');
    assertEquals(await at(istanbul.id, '2026-10-25', 'morning'), '2026-10-25T07:00:00.000Z');
    assertEquals(await at(berlin.id, '2026-10-24', 'morning'), '2026-10-24T08:00:00.000Z');
    // One briefing job per briefing row.
    const jobs = await q<{ idempotency_key: string }>(
      `select idempotency_key from public.jobs where type = 'briefing' and user_id = any($1::uuid[])`,
      [users],
    );
    assertEquals(jobs.length, rows.length);
    assertEquals(new Set(jobs.map((j) => j.idempotency_key)).size, jobs.length);
  },
);
