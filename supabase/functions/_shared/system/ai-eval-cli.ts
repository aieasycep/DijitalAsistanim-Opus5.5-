/**
 * `pnpm ai:eval:live` — the nightly `ai-eval` workflow (TEST_PLAN §13 `ai-eval`; AI_PIPELINE_PLAN
 * §5.4 "Gate run", §16.3). Runs every eval suite (or `AI_EVAL_SUITES`, comma-separated prompt keys)
 * against the active prompt version and every configured target of the project it points at
 * (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`; the workflow uses the staging environment), with the
 * provider keys of the CI environment, and records each report through `public.ai_eval_record`
 * like the `ai_eval` job does. `AI_EVAL_DRY_RUN=true` runs and prints without recording.
 *
 * Nothing is skipped silently: without the database credentials, or without the key of a provider a
 * configured target uses, it stops before any model call with "External credential required" and
 * the names (exit 2; a GitHub `::error` annotation in Actions). A failed gate exits 1. The printed
 * report holds counts, gates and costs only (no prompt, case or output text).
 *
 * Usage: deno run --allow-env --allow-read --allow-net supabase/functions/_shared/system/ai-eval-cli.ts
 */
import {
  cachedReader,
  type DatasetReader,
  datasetVersion,
  fileDatasets,
} from '../ai/evals/datasets.ts';
import {
  buildReport,
  type EvalReport,
  type EvalTargetResult,
  evalTargets,
  reportLines,
  runSlices,
  targetResult,
} from '../ai/evals/runner.ts';
import { type EvalStore, supabaseEvalStore } from '../ai/evals/store.ts';
import { EVAL_SUITES, type EvalSuite, type Tally } from '../ai/evals/suites.ts';
import type { ProviderId } from '../ai/types.ts';
import { clientConfigFromEnv, serviceClient } from '../db/clients.ts';
import { processEnv, type RawEnv, supabaseRuntimeKeys } from '../env.ts';
import { createLogger } from '../logging/logger.ts';
import { type AiServices, createAiServices } from '../services/ai/runtime.ts';

/** The key each provider's adapter needs (INTEGRATION_PLAN §15). */
export const PROVIDER_KEYS: Readonly<Record<ProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  voyage: 'VOYAGE_API_KEY',
  deepgram: 'STT_API_KEY',
  azure_speech: 'TTS_API_KEY',
  elevenlabs: 'TTS_API_KEY',
  fixture: 'AI_FIXTURE_PROVIDER_ENABLED',
  native: 'AI_FIXTURE_PROVIDER_ENABLED',
};

export interface CliIo {
  readonly out: (line: string) => void;
}

export interface CliDeps {
  readonly raw: RawEnv;
  readonly io: CliIo;
  /** Injected in tests; built from `raw` otherwise. */
  readonly services?: { readonly ai: AiServices; readonly store: EvalStore };
  readonly datasets?: DatasetReader;
  readonly now?: () => Date;
}

function annotate(raw: RawEnv, io: CliIo, title: string, message: string): void {
  if (raw.GITHUB_ACTIONS === 'true') io.out(`::error title=${title}::${message}`);
  io.out(`${title}: ${message}`);
}

/** The suites to run: every suite, or the known keys of `AI_EVAL_SUITES`. */
export function selectedSuites(raw: RawEnv): { suites: EvalSuite[]; unknown: string[] } {
  const all = Object.values(EVAL_SUITES) as EvalSuite[];
  const wanted = (raw.AI_EVAL_SUITES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (wanted.length === 0) return { suites: all, unknown: [] };
  return {
    suites: all.filter((s) => wanted.includes(s.key)),
    unknown: wanted.filter((w) => !all.some((s) => s.key === w)),
  };
}

function services(raw: RawEnv): { ai: AiServices; store: EvalStore } {
  const system = serviceClient(clientConfigFromEnv(raw));
  return {
    ai: createAiServices(system, raw, createLogger({ fn: 'ai-eval' })),
    store: supabaseEvalStore(system),
  };
}

export async function runCli(deps: CliDeps): Promise<number> {
  const { raw, io } = deps;
  const now = deps.now ?? (() => new Date());
  const { suites, unknown } = selectedSuites(raw);
  if (unknown.length > 0 || suites.length === 0) {
    annotate(raw, io, 'Invalid input', `AI_EVAL_SUITES names no eval suite: ${unknown.join(', ')}`);
    return 2;
  }
  if (deps.services === undefined) {
    const url = raw.SUPABASE_URL?.trim() ?? '';
    const missing = [
      ...(url === '' ? ['SUPABASE_URL'] : []),
      ...(supabaseRuntimeKeys(raw, url).secretKey === null ? ['SUPABASE_SECRET_KEY'] : []),
    ];
    if (missing.length > 0) {
      annotate(raw, io, 'External credential required', missing.join(', '));
      return 2;
    }
  }
  const { ai, store } = deps.services ?? services(raw);
  const read = cachedReader(deps.datasets ?? fileDatasets());
  const dryRun = raw.AI_EVAL_DRY_RUN?.trim() === 'true';

  // Plan every suite first: the credential check covers all targets before any model call.
  const plans = [];
  const needed = new Map<string, string[]>();
  for (const suite of suites) {
    const version = await store.version(suite.key, null);
    if (version === null) {
      annotate(raw, io, 'Eval setup', `${suite.key} has no active prompt version`);
      return 2;
    }
    const rows = await store.modelConfigs(suite.feature);
    const targets = evalTargets(rows, suite.feature);
    if (targets.length === 0) {
      annotate(raw, io, 'Eval setup', `${suite.feature} has no ai_model_config row`);
      return 2;
    }
    for (const t of targets) {
      if (ai.providers.available(t.provider)) continue;
      const key = PROVIDER_KEYS[t.provider];
      needed.set(key, [...(needed.get(key) ?? []), `${suite.feature} ${t.provider}/${t.model}`]);
    }
    plans.push({ suite, version, rows, targets });
  }
  if (needed.size > 0) {
    const detail = [...needed.entries()]
      .map(([key, uses]) => `${key} (for ${uses.join('; ')})`)
      .join(', ');
    annotate(raw, io, 'External credential required', detail);
    return 2;
  }

  const reports: EvalReport[] = [];
  for (const { suite, version, rows, targets } of plans) {
    const results: EvalTargetResult[] = [];
    for (const target of targets) {
      const tally: Tally = {};
      const row =
        rows.find(
          (r) =>
            (r.provider === target.provider && r.model === target.model) ||
            r.fallback_targets.some(
              (f) => f.provider === target.provider && f.model === target.model,
            ),
        ) ?? rows[0]!;
      await runSlices({
        base: ai.runtime,
        suite,
        row,
        target,
        version,
        read,
        cursor: 0,
        tally,
        correlationId: crypto.randomUUID(),
        ...(ai.canary === undefined ? {} : { canary: ai.canary }),
        deadline: Number.POSITIVE_INFINITY,
      });
      results.push(targetResult(suite, target, tally));
    }
    const report = buildReport({
      mode: ai.providers.fixtureMode ? 'fixture' : 'live',
      suite,
      version,
      datasetVersion: await datasetVersion(read, suite.datasets),
      runId: crypto.randomUUID(),
      trigger: 'ci',
      finishedAt: now(),
      results,
    });
    reports.push(report);
    for (const line of reportLines(report)) io.out(line);
    if (!dryRun) {
      await store.record({
        versionId: version.id,
        report,
        passed: report.passed,
        datasetVersion: report.dataset_version,
      });
    }
  }
  const failed = reports.filter((r) => !r.passed).map((r) => r.suite);
  io.out(
    failed.length === 0
      ? `ai-eval: ${String(reports.length)} suite(s) passed${dryRun ? ' (dry run, nothing recorded)' : ''}`
      : `ai-eval: failed suites: ${failed.join(', ')}`,
  );
  if (failed.length > 0) annotate(raw, io, 'Eval gate failed', failed.join(', '));
  return failed.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const code = await runCli({
    raw: processEnv(),
    io: {
      out: (line) => {
        // deno-lint-ignore no-console
        console.info(line);
      },
    },
  });
  Deno.exit(code);
}
