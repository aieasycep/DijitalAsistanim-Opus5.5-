/** `storage` probe: a list call on the private `captures` bucket with the service client. */
import { type Probe, timed } from './types.ts';

export const storageProbe: Probe = async (ctx) => {
  const result = await timed(ctx, () => ctx.data.listStorage('captures'));
  if (!result.ok)
    return {
      component: 'storage',
      status: 'degraded',
      latencyMs: result.latencyMs,
      detailCode: 'list_failed',
    };
  return { component: 'storage', status: 'healthy', latencyMs: result.latencyMs, detailCode: null };
};
