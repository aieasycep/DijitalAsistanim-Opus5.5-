/**
 * The shared System Health run (API_CONTRACTS §14 HLT-02, JOB-26): runs the selected probes
 * in-process and writes one `system_health_checks` row per persisted component. Both callers use it:
 * `POST /health/run` (automations secret or an admin with `health.run`) and the worker's
 * `health_check` job, which `da_health_check` enqueues every 5 minutes.
 */
import { admin as adminSchemas } from '@da/validation';
import { OUTBOUND } from '../_shared/config.ts';
import type { RawEnv } from '../_shared/env.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import { demoModeState } from '../_shared/providers/demo/guard.ts';
import type { HealthRow, HealthWriter } from './data.ts';
import { PERSISTED_COMPONENTS, PROBES } from './probes/index.ts';
import type { HealthData, HealthStatus, ProbeContext, ProbeResult } from './probes/types.ts';

export type HealthCaller = 'cron' | 'admin';

export async function runProbes(
  ctx: ProbeContext,
  names: readonly string[],
): Promise<ProbeResult[]> {
  const results = await Promise.all(
    names.map(async (name) => {
      const entry = PROBES[name];
      if (entry === undefined) return [];
      try {
        const out = await entry.probe(ctx);
        return Array.isArray(out) ? out : [out];
      } catch {
        return entry.components.map((component): ProbeResult => ({
          component,
          status: 'unknown',
          latencyMs: null,
          detailCode: 'probe_error',
        }));
      }
    }),
  );
  return results.flat();
}

export interface HealthRunDeps {
  readonly raw: RawEnv;
  readonly data: HealthData;
  readonly writer: HealthWriter;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface HealthRunInput {
  /** The `HealthProbe` names to run; `undefined` runs every probe. */
  readonly probes?: readonly string[] | undefined;
  readonly caller: HealthCaller;
  readonly correlationId: string;
  readonly log: Logger;
}

export interface HealthRunResult {
  readonly probe: string;
  readonly status: HealthStatus;
  readonly latency_ms: number | null;
  readonly detail_code: string | null;
  readonly checked_at: string;
}

export interface HealthRunOutcome {
  /** The contract probes (`HealthProbe`) that ran, in probe order. */
  readonly results: HealthRunResult[];
  /** Rows written to `system_health_checks`. */
  readonly written: number;
}

const CONTRACT_PROBES: ReadonlySet<string> = new Set(adminSchemas.HEALTH_PROBE_VALUES);

/** Runs the probes, persists the rows and returns the contract view (HLT-02 output). */
export async function executeHealthRun(
  deps: HealthRunDeps,
  input: HealthRunInput,
): Promise<HealthRunOutcome> {
  const now = deps.now ?? (() => new Date());
  const requested = input.probes;
  // `ai_*` probes share one module; the pending components run with every full run.
  const names =
    requested === undefined
      ? Object.keys(PROBES)
      : [...new Set(requested.map((p) => (p.startsWith('ai_') ? 'ai' : p)))];

  const url = (deps.raw.API_PUBLIC_BASE_URL ?? deps.raw.SUPABASE_URL)?.trim();
  const ctx: ProbeContext = {
    raw: deps.raw,
    data: deps.data,
    fetch: deps.fetch ?? fetch,
    now,
    timeoutMs: OUTBOUND.healthProbeTimeoutMs,
    demo: demoModeState(deps.raw),
    baseUrl: url === undefined || url === '' ? null : url.replace(/\/+$/, ''),
  };
  const results = await runProbes(ctx, names);
  const checkedAt = now().toISOString();
  const selected = requested === undefined ? null : new Set<string>(requested);

  const rows: HealthRow[] = [];
  for (const r of results) {
    if (!PERSISTED_COMPONENTS.has(r.component)) {
      input.log.info('health_probe_unpersisted', {
        component: r.component,
        status: r.status,
        detail_code: r.detailCode,
      });
      continue;
    }
    if (selected !== null && !selected.has(r.component)) continue;
    rows.push({
      component: r.component,
      status: r.status,
      latency_ms: r.latencyMs,
      detail: { code: r.detailCode, ...(r.detail ?? {}), correlation_id: input.correlationId },
      checked_by: input.caller,
      checked_at: checkedAt,
    });
  }
  await deps.writer.insert(rows);

  return {
    written: rows.length,
    results: results
      .filter(
        (r) => CONTRACT_PROBES.has(r.component) && (selected === null || selected.has(r.component)),
      )
      .map((r) => ({
        probe: r.component,
        status: r.status,
        latency_ms: r.latencyMs === null ? null : Math.max(0, Math.round(r.latencyMs)),
        detail_code: r.detailCode,
        checked_at: checkedAt,
      })),
  };
}
