/**
 * The eval gate run (AI_PIPELINE_PLAN §5.4 "Gate run", §16.3): a suite runs once per configured
 * target of its route (the primary and each fallback of the `balanced` and `lean` rows, deduplicated)
 * against the prompt version under test. Each target run gets a pinned runtime:
 *
 * - the route of the suite's feature is that one target (no fallback, no escalation) whatever the
 *   kill switches and breakers say — the eval measures the model, activation is gated on the result;
 * - the prompt version under test replaces the active one for its key (a draft can be evaluated);
 * - no budget reservation and no result cache (a cached answer is not a measurement);
 * - every attempt is still one content-free `ai_requests` row, marked `feature_variant = 'eval'`
 *   with no user and no plan, and its tokens and cost are summed into the report.
 *
 * A run stops at a case boundary when its time budget is spent and reports where to continue, so the
 * worker can split a long suite over several jobs (the counters travel in the payload).
 */
import type { AiFeature } from '@da/domain';
import type { AiRuntime } from '../call.ts';
import type { PromptVersion } from '../prompts/registry.ts';
import type { ModelConfigRow, ProviderId, TargetParams } from '../types.ts';
import type { AiRequestRow } from '../telemetry.ts';
import type { DatasetReader } from './datasets.ts';
import { evalUser } from './rows.ts';
import { bump, type EvalGate, type EvalSuite, type Tally } from './suites.ts';

export interface EvalTarget {
  readonly provider: ProviderId;
  readonly model: string;
  readonly params: TargetParams;
}

/** Primary then fallbacks of `balanced`, then of `lean`; one entry per provider and model. */
export function evalTargets(rows: readonly ModelConfigRow[], feature: AiFeature): EvalTarget[] {
  const out: EvalTarget[] = [];
  const order = ['balanced', 'lean'];
  const matching = rows
    .filter((r) => r.feature === feature)
    .sort((a, b) => order.indexOf(a.profile) - order.indexOf(b.profile));
  for (const row of matching) {
    const chain: EvalTarget[] = [
      { provider: row.provider, model: row.model, params: row.params },
      ...row.fallback_targets.map((t) => ({
        provider: t.provider,
        model: t.model,
        params: t.params ?? {},
      })),
    ];
    for (const target of chain)
      if (!out.some((t) => t.provider === target.provider && t.model === target.model))
        out.push(target);
  }
  return out;
}

/** Counters the telemetry wrapper keeps per target run (added to the target's metrics). */
const USAGE_KEYS = ['requests', 'input_tokens', 'output_tokens', 'cost_usd_micros'] as const;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The runtime of one target run (see the module comment). */
export function pinnedRuntime(
  base: AiRuntime,
  input: {
    readonly feature: AiFeature;
    readonly row: ModelConfigRow;
    readonly target: EvalTarget;
    readonly version: PromptVersion;
    readonly usage: Tally;
  },
): AiRuntime {
  const pinned: ModelConfigRow = {
    ...input.row,
    provider: input.target.provider,
    model: input.target.model,
    params: input.target.params,
    fallback_targets: [],
    escalation_target: null,
    enabled: true,
  };
  return {
    ...base,
    router: {
      configs: {
        get: (profile, feature, role) =>
          feature === input.feature
            ? Promise.resolve(pinned)
            : base.router.configs.get(profile, feature, role),
      },
      providerAvailable: (provider) => base.router.providerAvailable(provider),
    },
    prompts: {
      active: (key) =>
        key === input.version.prompt_key
          ? Promise.resolve(input.version)
          : base.prompts.active(key),
    },
    budget: {
      reserve: () =>
        Promise.resolve({ allow: true, level: 'l0', reason: null, reservationId: null }),
      settle: () => Promise.resolve(),
    },
    cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    telemetry: {
      insert(row: AiRequestRow) {
        bump(input.usage, 'requests');
        bump(input.usage, 'input_tokens', num(row.input_tokens));
        bump(input.usage, 'output_tokens', num(row.output_tokens));
        bump(input.usage, 'cost_usd_micros', num(row.cost_usd_micros));
        return base.telemetry.insert({
          ...row,
          user_id: null,
          plan: null,
          feature_variant: 'eval',
          content_hash: null,
        });
      },
      ...(base.telemetry.annotate === undefined
        ? {}
        : { annotate: base.telemetry.annotate.bind(base.telemetry) }),
    },
  };
}

export interface SliceInput {
  readonly base: AiRuntime;
  readonly suite: EvalSuite;
  readonly row: ModelConfigRow;
  readonly target: EvalTarget;
  readonly version: PromptVersion;
  readonly read: DatasetReader;
  readonly cursor: number;
  /** Counters so far (mutated). */
  readonly tally: Tally;
  readonly correlationId: string;
  readonly jobId?: string | null;
  readonly canary?: string;
  /** Epoch ms after which no new slice starts. */
  readonly deadline: number;
  readonly now?: () => number;
}

export interface SliceResult {
  readonly cursor: number;
  readonly size: number;
  readonly done: boolean;
}

/** Runs slices of the suite from `cursor` until it ends or the deadline passes. */
export async function runSlices(input: SliceInput): Promise<SliceResult> {
  const now = input.now ?? Date.now;
  const size = await input.suite.size(input.read);
  const runtime = pinnedRuntime(input.base, {
    feature: input.suite.feature,
    row: input.row,
    target: input.target,
    version: input.version,
    usage: input.tally,
  });
  const ctx = {
    runtime,
    user: evalUser([input.suite.feature]),
    correlationId: input.correlationId,
    jobId: input.jobId ?? null,
    ...(input.canary === undefined ? {} : { canary: input.canary }),
  };
  let cursor = input.cursor;
  // At least one slice per call, so a continuation always makes progress.
  let first = true;
  while (cursor < size && (first || now() < input.deadline)) {
    const to = Math.min(size, cursor + input.suite.step);
    await input.suite.run(ctx, input.read, cursor, to, input.tally);
    cursor = to;
    first = false;
  }
  return { cursor, size, done: cursor >= size };
}

export interface EvalTargetResult {
  readonly provider: ProviderId;
  readonly model: string;
  readonly passed: boolean;
  readonly cases: number;
  readonly gates: readonly EvalGate[];
  readonly usage: Readonly<Record<(typeof USAGE_KEYS)[number], number>>;
}

/** The gates of a finished target run, with its usage counters. */
export function targetResult(suite: EvalSuite, target: EvalTarget, tally: Tally): EvalTargetResult {
  const gates = suite.gates(tally);
  return {
    provider: target.provider,
    model: target.model,
    passed: gates.every((g) => g.passed),
    cases: tally.cases ?? 0,
    gates,
    usage: {
      requests: tally.requests ?? 0,
      input_tokens: tally.input_tokens ?? 0,
      output_tokens: tally.output_tokens ?? 0,
      cost_usd_micros: tally.cost_usd_micros ?? 0,
    },
  };
}

export interface EvalReport {
  readonly mode: 'live' | 'fixture';
  readonly suite: string;
  readonly feature: AiFeature;
  readonly prompt_version: number;
  readonly dataset_version: string;
  readonly run_id: string;
  readonly trigger: string;
  readonly finished_at: string;
  readonly passed: boolean;
  /** `[{provider, model, passed}]`: what `private.model_eval_passed` reads. */
  readonly targets: readonly { provider: ProviderId; model: string; passed: boolean }[];
  readonly results: readonly EvalTargetResult[];
}

export function buildReport(input: {
  readonly mode: 'live' | 'fixture';
  readonly suite: EvalSuite;
  readonly version: PromptVersion;
  readonly datasetVersion: string;
  readonly runId: string;
  readonly trigger: string;
  readonly finishedAt: Date;
  readonly results: readonly EvalTargetResult[];
}): EvalReport {
  return {
    mode: input.mode,
    suite: input.suite.key,
    feature: input.suite.feature,
    prompt_version: input.version.version,
    dataset_version: input.datasetVersion,
    run_id: input.runId,
    trigger: input.trigger,
    finished_at: input.finishedAt.toISOString(),
    passed: input.results.length > 0 && input.results.every((r) => r.passed),
    targets: input.results.map((r) => ({ provider: r.provider, model: r.model, passed: r.passed })),
    results: input.results,
  };
}

/** Plain-text lines for logs, the job result and the workflow summary (no content). */
export function reportLines(report: EvalReport): string[] {
  const lines = [
    `${report.suite} v${String(report.prompt_version)} (${report.mode}, ${report.dataset_version}): ${report.passed ? 'PASSED' : 'FAILED'}`,
  ];
  for (const r of report.results) {
    lines.push(
      `  ${r.provider}/${r.model}: ${r.passed ? 'passed' : 'failed'} · ${String(r.cases)} cases · ${String(r.usage.requests)} requests · $${(r.usage.cost_usd_micros / 1e6).toFixed(4)}`,
    );
    for (const g of r.gates)
      lines.push(
        `    ${g.passed ? 'ok  ' : 'FAIL'} ${g.name} ${String(g.value)} ${g.op} ${String(g.threshold)}`,
      );
  }
  return lines;
}
