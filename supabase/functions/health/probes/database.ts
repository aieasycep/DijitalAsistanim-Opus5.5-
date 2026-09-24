/** `database` probe: a timed read through PostgREST (degraded above 300 ms). */
import { type Probe, timed } from './types.ts';

export const databaseProbe: Probe = async (ctx) => {
  const result = await timed(ctx, () => ctx.data.pingDatabase());
  if (!result.ok)
    return {
      component: 'database',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'query_failed',
    };
  const slow = result.latencyMs > 300;
  return {
    component: 'database',
    status: slow ? 'degraded' : 'healthy',
    latencyMs: result.latencyMs,
    detailCode: slow ? 'slow' : null,
  };
};
