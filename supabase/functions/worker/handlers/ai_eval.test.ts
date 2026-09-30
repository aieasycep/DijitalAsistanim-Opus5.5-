/**
 * `ai_eval` job (AI_PIPELINE_PLAN §5.4 "Gate run", §16.3) on the fixture provider: every suite passes
 * the fixture baseline through the job path; each configured target is evaluated on a pinned route
 * without budget or cache and with eval-marked, user-free telemetry; long suites continue in
 * follow-up jobs with a bounded payload; the report lands through the store once; failures of the
 * setup end the job without retries.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import type { ModelConfigRow } from '../../_shared/ai/types.ts';
import { JobError } from '../../_shared/jobs/types.ts';
import { cachedReader, datasetVersion, fileDatasets } from '../../_shared/ai/evals/datasets.ts';
import type { EvalRecordInput, EvalStore, EvalVersion } from '../../_shared/ai/evals/store.ts';
import { EVAL_SUITES } from '../../_shared/ai/evals/suites.ts';
import { EVAL_SUITE_KEYS, hasEvalSuite } from '../../_shared/ai/evals/keys.ts';
import { evalTargets, reportLines } from '../../_shared/ai/evals/runner.ts';
import { configRow } from '../../_shared/testing/ai.ts';
import { fixtureServices, jobContext } from '../../_shared/testing/intel.ts';
import { assistFlags } from '../../_shared/testing/assist.ts';
import { AiEvalPayload, aiEvalJob, isoWeek, runAiEval } from './ai_eval.ts';

const VERSION_ID = '0190f5e0-0000-7000-8000-00000000e001';

function version(key: string, status: EvalVersion['status'] = 'active'): EvalVersion {
  return {
    id: VERSION_ID,
    prompt_key: key as EvalVersion['prompt_key'],
    version: 3,
    status,
    system_prompt: `Sistem: ${key}`,
    user_template: 'Sayı: {{count}}',
    output_schema_ref: key,
    schema_hash: 'a'.repeat(64),
    model_role: 'classifier',
    model_constraints: {},
  };
}

/** A balanced row with an OpenAI fallback plus a lean row on a third model. */
function rows(feature: ModelConfigRow['feature']): ModelConfigRow[] {
  return [
    configRow({
      id: 'cfg-b',
      feature,
      profile: 'balanced',
      role: 'classifier',
      provider: 'anthropic',
      model: 'eval-primary',
      params: { max_output_tokens: 1500 },
      fallback_targets: [{ provider: 'openai', model: 'eval-fallback', params: {} }],
    }),
    configRow({
      id: 'cfg-l',
      feature,
      profile: 'lean',
      role: 'classifier',
      provider: 'openai',
      model: 'eval-fallback',
      params: {},
      fallback_targets: [{ provider: 'anthropic', model: 'eval-lean', params: {} }],
    }),
  ];
}

function memoryStore(
  key: string,
  options: { version?: EvalVersion | null; rows?: ModelConfigRow[] } = {},
): EvalStore & { recorded: EvalRecordInput[] } {
  const recorded: EvalRecordInput[] = [];
  const suite = EVAL_SUITES[key as keyof typeof EVAL_SUITES];
  return {
    recorded,
    version: () => Promise.resolve(options.version === undefined ? version(key) : options.version),
    modelConfigs: () =>
      Promise.resolve(options.rows ?? (suite === undefined ? [] : rows(suite.feature))),
    record(input) {
      recorded.push(input);
      return Promise.resolve({ model_rows: 2 });
    },
  };
}

function services(unavailable: string[] = []) {
  const ai = fixtureServices({ user: { flags: assistFlags() } });
  const runtime = {
    ...ai.services.runtime,
    router: {
      ...ai.services.runtime.router,
      providerAvailable: (p: string) => !unavailable.includes(p),
    },
  };
  return { ai, services: { ...ai.services, runtime } };
}

const payload = (key: string, extra: Record<string, unknown> = {}) =>
  AiEvalPayload.parse({ prompt_key: key, ...extra });

for (const key of Object.keys(EVAL_SUITES)) {
  Deno.test(`ai_eval ${key}: the fixture baseline passes on every configured target`, async () => {
    const { ai, services: svc } = services();
    const store = memoryStore(key);
    const ctx = jobContext(payload(key), { type: 'ai_eval' });
    const result = await runAiEval({ ai: svc, store, datasets: fileDatasets() }, ctx);
    assertEquals(result.passed, true, JSON.stringify(store.recorded[0]?.report.results));
    assertEquals(result.mode, 'fixture');
    assertEquals(ctx.enqueued, []);
    assertEquals(store.recorded.length, 1);
    const recorded = store.recorded[0]!;
    assertEquals(recorded.versionId, VERSION_ID);
    assertEquals(recorded.passed, true);
    assertEquals(
      recorded.report.targets.map((t) => `${t.provider}/${t.model}:${String(t.passed)}`),
      ['anthropic/eval-primary:true', 'openai/eval-fallback:true', 'anthropic/eval-lean:true'],
    );
    assert(recorded.datasetVersion.startsWith('sha256:'));
    assertEquals(recorded.report.prompt_version, 3);
    // Eval calls: no budget, no cache, telemetry without a user and marked `eval`.
    assertEquals(ai.budget.reserves, []);
    assertEquals(ai.cache.entries.size, 0);
    assert(ai.telemetry.rows.length > 0 || key === 'email_classification');
    for (const row of ai.telemetry.rows) {
      assertEquals([row.user_id, row.plan, row.feature_variant], [null, null, 'eval']);
    }
    const usage = recorded.report.results.reduce((n, r) => n + r.usage.requests, 0);
    assertEquals(usage, ai.telemetry.rows.length);
  });
}

Deno.test('ai_eval: a pinned route evaluates the draft version under test', async () => {
  const { ai, services: svc } = services();
  const draft = { ...version('assistant_intent', 'draft'), system_prompt: 'TASLAK-ISTEM' };
  const store = memoryStore('assistant_intent', { version: draft });
  await runAiEval(
    { ai: svc, store, datasets: fileDatasets() },
    jobContext(payload('assistant_intent', { prompt_version_id: VERSION_ID }), { type: 'ai_eval' }),
  );
  assert(
    ai.prompts.some((p) => p.text.includes('TASLAK-ISTEM')),
    'the draft prompt was used',
  );
  const models = new Set(ai.telemetry.rows.map((r) => r.model));
  assertEquals([...models].sort(), ['eval-fallback', 'eval-lean', 'eval-primary']);
  assert(
    ai.telemetry.rows.every((r) => r.fallback_used === false),
    'one target per run',
  );
});

Deno.test(
  'ai_eval: an unavailable target fails its gates and the version is recorded as failed',
  async () => {
    const { services: svc } = services(['openai']);
    const store = memoryStore('post_meeting');
    const result = await runAiEval(
      { ai: svc, store, datasets: fileDatasets() },
      jobContext(payload('post_meeting'), { type: 'ai_eval' }),
    );
    assertEquals(result.passed, false);
    const report = store.recorded[0]!.report;
    assertEquals(
      report.targets.map((t) => `${t.model}:${String(t.passed)}`),
      ['eval-primary:true', 'eval-fallback:false', 'eval-lean:true'],
    );
    const failed = report.results[1]!;
    assert(failed.gates.some((g) => g.name === 'unserved' && !g.passed));
    assert(reportLines(report).some((l) => l.includes('FAIL unserved')));
    assertEquals(store.recorded[0]!.passed, false);
  },
);

Deno.test(
  'ai_eval: a spent budget continues in follow-up jobs with a bounded payload',
  async () => {
    const { services: svc } = services();
    const store = memoryStore('meeting_prep');
    const deps = { ai: svc, store, datasets: fileDatasets(), budgetMs: 0 };
    let current = payload('meeting_prep');
    let steps = 0;
    const keys = new Set<string>();
    for (;;) {
      const ctx = jobContext(current, { type: 'ai_eval' });
      const result = await runAiEval(deps, ctx);
      steps += 1;
      if (result.continued !== true) break;
      assertEquals(ctx.enqueued.length, 1);
      const next = ctx.enqueued[0]!;
      assertEquals(next.type, 'ai_eval');
      assert(!keys.has(next.idempotencyKey), 'every continuation has its own key');
      keys.add(next.idempotencyKey);
      assert(
        next.idempotencyKey.startsWith(
          `ai_eval:meeting_prep:${isoWeek(new Date('2026-09-24T06:30:00Z'))}:v3:`,
        ),
      );
      assert(new TextEncoder().encode(JSON.stringify(next.payload)).length < 8192, 'payload cap');
      current = AiEvalPayload.parse(next.payload);
      assert(steps < 100, 'progress on every step');
    }
    // 8 cases × 3 targets, one slice per job; a job that finishes a target starts the next one.
    assertEquals(steps, 22);
    assertEquals(store.recorded.length, 1);
    assertEquals(
      store.recorded[0]!.report.results.map((r) => r.cases),
      [8, 8, 8],
    );
    assertEquals(store.recorded[0]!.passed, true);
  },
);

Deno.test('ai_eval: setup failures end the job without retries', async () => {
  const { services: svc } = services();
  const deps = (store: EvalStore) => ({ ai: svc, store, datasets: fileDatasets() });
  const expect = async (store: EvalStore, key: string, code: string) => {
    const error = await assertRejects(
      () => runAiEval(deps(store), jobContext(payload(key), { type: 'ai_eval' })),
      JobError,
    );
    assertEquals([error.code, error.retryable], [code, false]);
  };
  await expect(memoryStore('thread_summary'), 'thread_summary', 'NO_EVAL_SET');
  await expect(memoryStore('capture', { version: null }), 'capture', 'NOT_FOUND');
  await expect(memoryStore('capture', { rows: [] }), 'capture', 'NO_MODEL_CONFIG');
});

Deno.test('ai_eval: the admin-api key list matches the suites', () => {
  assertEquals([...EVAL_SUITE_KEYS].sort(), Object.keys(EVAL_SUITES).sort());
  assert(hasEvalSuite('capture'));
  assert(!hasEvalSuite('thread_summary'));
  for (const [key, suite] of Object.entries(EVAL_SUITES)) assertEquals(suite?.key, key);
});

Deno.test('ai_eval: job definition, payload defaults and helpers', async () => {
  const def = aiEvalJob({} as never);
  assertEquals([def.type, def.timeoutMs], ['ai_eval', 180_000]);
  const parsed = AiEvalPayload.parse({ prompt_key: 'capture' });
  assertEquals(
    [parsed.prompt_version_id, parsed.trigger, parsed.step, parsed.cursor, parsed.results],
    [null, 'admin', 0, 0, []],
  );
  assertEquals(AiEvalPayload.safeParse({ prompt_key: 'nope' }).success, false);
  assertEquals(isoWeek(new Date('2026-09-24T06:30:00Z')), '2026-W39');
  assertEquals(isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  assertEquals(
    evalTargets(rows('capture_extract'), 'capture_extract').map((t) => t.model),
    ['eval-primary', 'eval-fallback', 'eval-lean'],
  );
  assertEquals(evalTargets(rows('capture_extract'), 'meeting_prep'), []);
  const read = cachedReader(fileDatasets());
  assertEquals(
    await datasetVersion(read, ['capture-tr.jsonl']),
    await datasetVersion(fileDatasets(), ['capture-tr.jsonl']),
  );
  await assertRejects(() => fileDatasets().read('../../../.env'), Error, 'unknown eval dataset');
});
