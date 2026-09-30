/**
 * `ai_eval` (AI_PIPELINE_PLAN §5.4 "Gate run", §16.3; DATABASE_AND_RLS_PLAN key
 * `ai_eval:{feature}:{iso_week}`; producers: `admin_api.ai_eval_request` behind
 * `POST /ai/prompts/:key/versions/:v/eval`, and the nightly `ai-eval` workflow, which runs the same
 * suites in CI). One job evaluates one prompt version (the active one when the payload names none)
 * on every configured target of its route:
 *
 * 1. the suite of the prompt key (`_shared/ai/evals/suites.ts`); a key without a golden set, an
 *    unknown version or a route without targets ends as `failed` (not retried);
 * 2. for each target (primary and fallbacks of the `balanced` and `lean` rows) the suite runs through
 *    a pinned runtime (`evals/runner.ts`: that target only, the version under test, no budget, no
 *    cache, `ai_requests.feature_variant = 'eval'`); against the fixture provider when
 *    `AI_FIXTURE_PROVIDER_ENABLED` serves every target (report `mode: 'fixture'`);
 * 3. when the slice budget is spent the job enqueues its continuation (cursor, counters and the
 *    finished targets travel in the payload, well under the 8 KiB cap) and completes;
 * 4. the last step records the report (`public.ai_eval_record`): `eval_report`, `eval_passed` (every
 *    target passed), `eval_dataset_version`, and for the active version `ai_model_config.eval_status`.
 */
import { PromptKey } from '@da/validation';
import { z } from 'zod';
import type { AiServices } from '../../_shared/services/ai/runtime.ts';
import { defineJob } from '../../_shared/jobs/registry.ts';
import {
  type JobContext,
  type JobDefinition,
  JobError,
  type Json,
} from '../../_shared/jobs/types.ts';
import {
  cachedReader,
  type DatasetReader,
  datasetVersion,
} from '../../_shared/ai/evals/datasets.ts';
import {
  buildReport,
  type EvalTarget,
  type EvalTargetResult,
  evalTargets,
  reportLines,
  runSlices,
  targetResult,
} from '../../_shared/ai/evals/runner.ts';
import type { EvalStore } from '../../_shared/ai/evals/store.ts';
import { suiteFor, type Tally } from '../../_shared/ai/evals/suites.ts';
import type { ModelConfigRow } from '../../_shared/ai/types.ts';

/** Slice budget per job; a model call is capped at 30 s, the job timeout leaves room for it. */
export const AI_EVAL_BUDGET_MS = 110_000;
export const AI_EVAL_TIMEOUT_MS = 180_000;

const Gate = z.object({
  name: z.string().max(60),
  value: z.number(),
  op: z.enum(['>=', '<=']),
  threshold: z.number(),
  passed: z.boolean(),
});

const TargetResult = z.object({
  provider: z.string().max(40),
  model: z.string().max(120),
  passed: z.boolean(),
  cases: z.int().min(0),
  gates: z.array(Gate).max(12),
  usage: z.object({
    requests: z.number().min(0),
    input_tokens: z.number().min(0),
    output_tokens: z.number().min(0),
    cost_usd_micros: z.number().min(0),
  }),
});

export const AiEvalPayload = z.object({
  prompt_key: PromptKey,
  prompt_version_id: z.uuid().nullable().default(null),
  trigger: z.enum(['admin', 'schedule', 'ci']).default('admin'),
  run_id: z.uuid().optional(),
  step: z.int().min(0).max(500).default(0),
  target_index: z.int().min(0).max(20).default(0),
  cursor: z.int().min(0).default(0),
  tally: z.record(z.string().max(80), z.number()).default({}),
  results: z.array(TargetResult).max(12).default([]),
});
export type AiEvalPayload = z.infer<typeof AiEvalPayload>;

export interface AiEvalJobDeps {
  readonly ai: AiServices;
  readonly store: EvalStore;
  readonly datasets: DatasetReader;
  readonly budgetMs?: number;
  readonly now?: () => number;
}

/** `2026-W39` (ISO week of the UTC date). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}

/** The model-config row whose chain holds the target (it supplies role, tier and caps). */
function rowOf(rows: readonly ModelConfigRow[], target: EvalTarget): ModelConfigRow {
  return (
    rows.find(
      (r) =>
        (r.provider === target.provider && r.model === target.model) ||
        r.fallback_targets.some((t) => t.provider === target.provider && t.model === target.model),
    ) ?? (rows[0] as ModelConfigRow)
  );
}

export async function runAiEval(
  deps: AiEvalJobDeps,
  ctx: JobContext<AiEvalPayload>,
): Promise<Record<string, Json>> {
  const now = deps.now ?? Date.now;
  const p = ctx.payload;
  const suite = suiteFor(p.prompt_key);
  if (suite === null) throw new JobError('NO_EVAL_SET', false);
  const version = await deps.store.version(p.prompt_key, p.prompt_version_id);
  if (version === null) throw new JobError('NOT_FOUND', false);
  const rows = await deps.store.modelConfigs(suite.feature);
  const targets = evalTargets(rows, suite.feature);
  if (targets.length === 0) throw new JobError('NO_MODEL_CONFIG', false);

  const read = cachedReader(deps.datasets);
  const runId = p.run_id ?? crypto.randomUUID();
  const deadline = now() + (deps.budgetMs ?? AI_EVAL_BUDGET_MS);
  const results: EvalTargetResult[] = [...(p.results as EvalTargetResult[])];
  let index = p.target_index;
  let cursor = p.cursor;
  let tally: Tally = { ...p.tally };

  while (index < targets.length) {
    const target = targets[index] as EvalTarget;
    const slice = await runSlices({
      base: deps.ai.runtime,
      suite,
      row: rowOf(rows, target),
      target,
      version,
      read,
      cursor,
      tally,
      correlationId: ctx.correlationId,
      jobId: ctx.job.id,
      ...(deps.ai.canary === undefined ? {} : { canary: deps.ai.canary }),
      deadline,
      now,
    });
    await ctx.progress({
      suite: suite.key,
      target: index + 1,
      targets: targets.length,
      cursor: slice.cursor,
      cases: slice.size,
    });
    if (!slice.done) {
      const step = p.step + 1;
      const next: AiEvalPayload = {
        prompt_key: p.prompt_key,
        prompt_version_id: version.id,
        trigger: p.trigger,
        run_id: runId,
        step,
        target_index: index,
        cursor: slice.cursor,
        tally,
        results: results as AiEvalPayload['results'],
      };
      const jobId = await ctx.enqueue({
        type: 'ai_eval',
        idempotencyKey: `ai_eval:${suite.feature}:${isoWeek(ctx.now())}:v${String(version.version)}:${runId}:${String(step)}`,
        payload: next as unknown as Json,
        priority: 200,
        maxAttempts: 3,
      });
      return {
        continued: true,
        next_job_id: jobId,
        step,
        target: index + 1,
        targets: targets.length,
        cursor: slice.cursor,
      };
    }
    results.push(targetResult(suite, target, tally));
    index += 1;
    cursor = 0;
    tally = {};
  }

  const report = buildReport({
    mode: deps.ai.providers.fixtureMode ? 'fixture' : 'live',
    suite,
    version,
    datasetVersion: await datasetVersion(read, suite.datasets),
    runId,
    trigger: p.trigger,
    finishedAt: ctx.now(),
    results,
  });
  const recorded = await deps.store.record({
    versionId: version.id,
    report,
    passed: report.passed,
    datasetVersion: report.dataset_version,
  });
  ctx.log.info('ai_eval_recorded', {
    suite: suite.key,
    version: version.version,
    passed: report.passed,
    mode: report.mode,
    targets: report.targets.length,
  });
  for (const line of reportLines(report)) ctx.log.info('ai_eval_report', { line });
  return {
    suite: suite.key,
    version: version.version,
    mode: report.mode,
    passed: report.passed,
    targets: report.targets as unknown as Json,
    dataset_version: report.dataset_version,
    model_rows: recorded.model_rows ?? 0,
  };
}

export function aiEvalJob(deps: AiEvalJobDeps): JobDefinition<AiEvalPayload> {
  return defineJob({
    type: 'ai_eval',
    payload: AiEvalPayload,
    timeoutMs: AI_EVAL_TIMEOUT_MS,
    handler: async (ctx) => await runAiEval(deps, ctx),
  });
}
