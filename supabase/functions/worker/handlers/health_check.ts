/**
 * JOB-26 `health_check` (API_CONTRACTS §11.4, §14 HLT-02; IMPLEMENTATION_PLAN T-3.07): the
 * `da_health_check` pg_cron job enqueues `health:{5-min bucket}` every 5 minutes; the worker runs
 * the System Health probe library in-process (the same `executeHealthRun` as `POST /health/run`),
 * writes the `system_health_checks` rows with `checked_by = 'cron'` and completes.
 *
 * - A job whose bucket is older than `HEALTH_CHECK_STALE_MS` completes as `skipped: 'stale'`
 *   without probing (a backlog after an outage is drained, not replayed; the next bucket probes).
 * - A `down` component is logged and reported to Sentry (the "outage raises a Sentry alert" step).
 * - Probes never throw (an unexpected error is `unknown`), so only a failed insert retries
 *   (`max_attempts` from `enqueue_job`; no dead-letter semantics are needed for a 5-min cadence).
 */
import { admin as adminSchemas } from '@da/validation';
import { z } from 'zod';
import type { RawEnv } from '../../_shared/env.ts';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobContext, JobDefinition } from '../../_shared/jobs/types.ts';
import type { Sentry } from '../../_shared/observability/sentry.ts';
import type { HealthWriter } from '../../health/data.ts';
import type { HealthData } from '../../health/probes/types.ts';
import { executeHealthRun } from '../../health/run.ts';

/** The cron cadence is 5 minutes; a job older than two buckets is a backlog item. */
export const HEALTH_CHECK_STALE_MS = 10 * 60_000;

export const HealthCheckPayload = z.object({
  probes: z.array(adminSchemas.HealthProbe).min(1).optional(),
});
export type HealthCheckPayload = z.infer<typeof HealthCheckPayload>;

export interface HealthCheckJobDeps {
  readonly raw: RawEnv;
  readonly data: HealthData;
  readonly writer: HealthWriter;
  readonly fetch?: typeof fetch;
  readonly sentry?: Sentry;
}

export class HealthOutage extends Error {
  constructor(readonly components: readonly string[]) {
    super(`health_outage:${components.join(',')}`);
    this.name = 'HealthOutage';
  }
}

export async function runHealthCheck(
  deps: HealthCheckJobDeps,
  ctx: JobContext<HealthCheckPayload>,
): Promise<Record<string, number | string>> {
  const now = ctx.now();
  const ageMs = now.getTime() - Date.parse(ctx.job.run_after);
  if (Number.isFinite(ageMs) && ageMs > HEALTH_CHECK_STALE_MS) {
    return { skipped: 'stale', age_s: Math.round(ageMs / 1000) };
  }
  const outcome = await executeHealthRun(
    {
      raw: deps.raw,
      data: deps.data,
      writer: deps.writer,
      now: () => ctx.now(),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    },
    {
      probes: ctx.payload.probes,
      caller: 'cron',
      correlationId: ctx.correlationId,
      log: ctx.log,
    },
  );
  const count = (status: string) => outcome.results.filter((r) => r.status === status).length;
  const down = outcome.results.filter((r) => r.status === 'down').map((r) => r.probe);
  if (down.length > 0) {
    ctx.log.error('health_check_outage', { components: down });
    await deps.sentry
      ?.captureException(new HealthOutage(down), {
        fn: 'worker',
        correlationId: ctx.correlationId,
        jobId: ctx.job.id,
        code: 'HEALTH_OUTAGE',
      })
      .catch(() => undefined);
  }
  return {
    probes: outcome.results.length,
    written: outcome.written,
    healthy: count('healthy'),
    degraded: count('degraded'),
    down: count('down'),
    external_credential_required: count('external_credential_required'),
    unknown: count('unknown'),
  };
}

export function healthCheckJob(deps: HealthCheckJobDeps): JobDefinition<HealthCheckPayload> {
  return defineJob({
    type: 'health_check',
    payload: HealthCheckPayload,
    handler: async (ctx) => ({ ...(await runHealthCheck(deps, ctx)) }),
  });
}
