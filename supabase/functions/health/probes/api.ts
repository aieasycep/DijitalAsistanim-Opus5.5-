/**
 * `api` probe: the Edge runtime answers `GET /health/live` through the gateway. It is `down` while
 * demo mode is on in production without the allowance (`demo_mode_forbidden`, shown in System Health
 * as the demo-in-production error) or while the server env fails validation (`env_invalid`).
 */
import { serverEnv } from '@da/validation';
import { type Probe, probeFetch, timed } from './types.ts';

export const apiProbe: Probe = async (ctx) => {
  if (ctx.demo === 'forbidden') {
    return { component: 'api', status: 'down', latencyMs: null, detailCode: 'demo_mode_forbidden' };
  }
  const env = serverEnv.safeParse(ctx.raw);
  if (!env.success) {
    const keys = [...new Set(env.error.issues.map((i) => String(i.path[0] ?? '')))].filter(
      (k) => k !== '',
    );
    return {
      component: 'api',
      status: 'down',
      latencyMs: null,
      detailCode: 'env_invalid',
      detail: { keys },
    };
  }
  const secret = ctx.raw.CRON_SECRET?.trim();
  if (ctx.baseUrl === null || secret === undefined || secret === '') {
    return {
      component: 'api',
      status: 'unknown',
      latencyMs: null,
      detailCode: 'self_check_unconfigured',
    };
  }
  const result = await timed(ctx, () =>
    probeFetch(ctx, `${ctx.baseUrl}/functions/v1/health/live`, { headers: { apikey: secret } }),
  );
  if (!result.ok)
    return {
      component: 'api',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'unreachable',
    };
  if (result.value !== 200) {
    return {
      component: 'api',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  }
  return {
    component: 'api',
    status: result.latencyMs > 1000 ? 'degraded' : 'healthy',
    latencyMs: result.latencyMs,
    detailCode: result.latencyMs > 1000 ? 'slow' : null,
  };
};
