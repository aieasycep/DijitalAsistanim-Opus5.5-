/**
 * JOB-13 `first_analysis` (T-5.15; R-19): each check is one short run re-queued after 3 s; the
 * steps and counts come from stored rows; the ranking phase enqueues `insight_refresh` and the
 * onboarding briefing; repeated real failures end the job.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { JobError } from '../../_shared/jobs/types.ts';
import type { EnqueueInput } from '../../_shared/jobs/types.ts';
import { ACCOUNT_ID, jobContext, MemoryIntel, NOW, uuid } from '../../_shared/testing/intel.ts';
import { assistFixture } from '../../_shared/testing/assist.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { FIRST_ANALYSIS_TICK_S } from '../../_shared/services/assist/first-analysis.ts';
import { type FirstAnalysisPayload, runFirstAnalysis } from './first_analysis.ts';

function setup() {
  const fx = assistFixture(new MemoryIntel());
  fx.store.accounts.push({
    id: ACCOUNT_ID,
    provider: 'google',
    status: 'healthy',
    last_sync_at: NOW.toISOString(),
    capabilities_granted: ['mail_read', 'calendar_read'],
    data_source_toggles: {},
  });
  const jobId = uuid();
  fx.store.jobs.push({
    id: jobId,
    type: 'first_analysis',
    status: 'running',
    user_id: USER_A,
    idempotency_key: `first_analysis:${USER_A}`,
    progress: {},
    result: null,
    created_at: NOW.toISOString(),
    last_error_code: null,
  });
  const payload: FirstAnalysisPayload = {
    user_id: USER_A,
    window_hours: 72,
    connected_account_ids: [],
  };
  const base = jobContext(payload, { type: 'first_analysis', id: jobId, maxAttempts: 200 });
  const ctx = {
    ...base,
    // The queue: enqueued children become rows the next check reads.
    enqueue(input: EnqueueInput) {
      base.enqueued.push(input);
      const id = uuid();
      fx.store.jobs.push({
        id,
        type: input.type,
        status: 'queued',
        user_id: USER_A,
        idempotency_key: input.idempotencyKey,
        progress: {},
        result: null,
        created_at: NOW.toISOString(),
        last_error_code: null,
      });
      return Promise.resolve(id);
    },
    progress(p: Record<string, unknown>) {
      fx.store.jobs[0]!.progress = p;
      return Promise.resolve();
    },
  };
  const progress = () =>
    fx.store.jobs[0]!.progress as {
      checks: number;
      phase: string;
      steps: { key: string; status: string; count: number | null }[];
    };
  const step = (key: string) => progress().steps.find((s) => s.key === key)!;
  const complete = (prefix: string) => {
    for (const j of fx.store.jobs) if (j.idempotency_key.startsWith(prefix)) j.status = 'completed';
  };
  return { fx, ctx, progress, step, complete };
}

async function pendingCheck(run: () => Promise<unknown>) {
  const error = await assertRejects(run, JobError);
  assertEquals(
    [error.code, error.retryable, error.retryAfterSeconds],
    ['FIRST_ANALYSIS_PENDING', true, FIRST_ANALYSIS_TICK_S],
  );
}

Deno.test('JOB-13: sync → classify → ranking → completed with stored counts (R-19)', async () => {
  const s = setup();
  const run = () => runFirstAnalysis(s.fx.jobs, s.ctx);

  await pendingCheck(run);
  const syncs = s.ctx.enqueued.filter((j) => j.type === 'initial_sync');
  assertEquals(syncs.map((j) => (j.payload as { resource: string }).resource).sort(), [
    'calendar',
    'mail',
  ]);
  assertEquals([s.step('scan_mail').status, s.step('calendar').status], ['running', 'running']);

  s.complete(`initial_sync:${ACCOUNT_ID}:`);
  s.fx.store.jobs.push({
    ...s.fx.store.jobs[0]!,
    id: uuid(),
    type: 'email_triage',
    status: 'running',
    idempotency_key: `email_triage:${ACCOUNT_ID}:a`,
  });
  s.fx.store.counts = {
    mails_found: 42,
    classified: 30,
    potential_important: 7,
    upcoming_events: 3,
    possible_followups: 2,
  };
  await pendingCheck(run);
  assertEquals([s.step('scan_mail').status, s.step('scan_mail').count], ['done', 42]);
  assertEquals([s.step('classify').status, s.step('calendar').status], ['running', 'done']);
  assertEquals(s.ctx.enqueued.filter((j) => j.type === 'initial_sync').length, 2);

  s.complete(`email_triage:${ACCOUNT_ID}:`);
  await pendingCheck(run);
  assertEquals(s.progress().phase, 'ranking');
  assert(s.ctx.enqueued.some((j) => j.type === 'insight_refresh'));
  const briefing = s.ctx.enqueued.find((j) => j.type === 'briefing')!;
  assertEquals((briefing.payload as { origin: string }).origin, 'first_analysis');

  s.complete(`insight_refresh:${USER_A}:`);
  s.complete(`briefing:${USER_A}:`);
  const result = (await run()) as {
    partial: boolean;
    counts: { mails_found: number };
    total_items: number;
  };
  assertEquals([result.partial, result.counts.mails_found], [false, 42]);
  assertEquals(s.progress().checks, 4);
  assertEquals(s.step('open_loops').status, 'done');
  assertEquals(s.fx.store.steps.at(-1), 'ready');
});

Deno.test(
  'JOB-13: a failed account makes the analysis partial; three real failures end it',
  async () => {
    const s = setup();
    s.fx.store.accounts.push({ ...s.fx.store.accounts[0]!, id: uuid(), status: 'needs_reauth' });
    await pendingCheck(() => runFirstAnalysis(s.fx.jobs, s.ctx));
    assertEquals((s.fx.store.jobs[0]!.progress as { partial: boolean }).partial, true);

    const broken = setup();
    broken.fx.store.accountSources = () => Promise.reject(new Error('db down'));
    await pendingCheck(() => runFirstAnalysis(broken.fx.jobs, broken.ctx));
    await pendingCheck(() => runFirstAnalysis(broken.fx.jobs, broken.ctx));
    const error = await assertRejects(() => runFirstAnalysis(broken.fx.jobs, broken.ctx), JobError);
    assertEquals([error.code, error.retryable], ['FIRST_ANALYSIS_FAILED', false]);
  },
);
