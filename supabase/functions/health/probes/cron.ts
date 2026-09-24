/**
 * `cron` probe. `cron.job_run_details` is not reachable through PostgREST, so the probe measures the
 * effects pg_cron guarantees: jobs it enqueues every 5 minutes (`health_check`, `push_receipts`) must
 * keep appearing, and claimable jobs must not wait (`scheduler_tick` / worker pokes). Queue lag
 * under 2 min is healthy, 2–5 min degraded, beyond that down (API_CONTRACTS §14).
 */
import type { HealthStatus, Probe } from './types.ts';

const MIN = 60_000;

function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  const order: HealthStatus[] = ['down', 'unknown', 'degraded', 'healthy'];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

export const cronProbe: Probe = async (ctx) => {
  const now = ctx.now();
  let stats;
  try {
    stats = await ctx.data.cronStats(now);
  } catch {
    return {
      component: 'cron',
      status: 'unknown',
      latencyMs: null,
      detailCode: 'stats_unavailable',
    };
  }
  const lagMs =
    stats.oldestReadyJobAt === null
      ? 0
      : Math.max(0, now.getTime() - Date.parse(stats.oldestReadyJobAt));
  const lagStatus: HealthStatus =
    lagMs < 2 * MIN ? 'healthy' : lagMs < 5 * MIN ? 'degraded' : 'down';
  const enqueueAge =
    stats.lastCronEnqueueAt === null ? null : now.getTime() - Date.parse(stats.lastCronEnqueueAt);
  const cronStatus: HealthStatus =
    enqueueAge === null
      ? 'unknown'
      : enqueueAge < 6 * MIN
        ? 'healthy'
        : enqueueAge < 15 * MIN
          ? 'degraded'
          : 'down';
  const status = worst(lagStatus, cronStatus);
  return {
    component: 'cron',
    status,
    latencyMs: null,
    detailCode: status === 'healthy' ? null : lagStatus !== 'healthy' ? 'queue_lag' : 'cron_stale',
    detail: {
      queue_lag_s: Math.round(lagMs / 1000),
      cron_enqueue_age_s: enqueueAge === null ? null : Math.round(enqueueAge / 1000),
      last_attempt_finished_at: stats.lastAttemptFinishedAt,
    },
  };
};
