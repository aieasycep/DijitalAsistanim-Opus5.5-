/** `revenuecat` probe: `GET /v2/projects/{project}` with the v2 secret key (429 / 5xx → degraded). */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, probeFetch, timed } from './types.ts';

export const revenuecatProbe: Probe = async (ctx) => {
  const missing = [
    ...credentialStatus('revenuecat', ctx.raw).missing,
    ...credentialStatus('revenuecat_webhook', ctx.raw).missing,
  ];
  if (missing.length > 0) return credentialRequired('revenuecat', missing);
  const project = encodeURIComponent(ctx.raw.REVENUECAT_PROJECT_ID?.trim() ?? '');
  const key = ctx.raw.REVENUECAT_API_V2_SECRET_KEY?.trim() ?? '';
  const result = await timed(ctx, () =>
    probeFetch(ctx, `https://api.revenuecat.com/v2/projects/${project}`, {
      headers: { Authorization: `Bearer ${key}` },
    }),
  );
  if (!result.ok)
    return {
      component: 'revenuecat',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'unreachable',
    };
  if (result.value === 429 || result.value >= 500) {
    return {
      component: 'revenuecat',
      status: 'degraded',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  }
  if (result.value !== 200) {
    return {
      component: 'revenuecat',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  }
  return {
    component: 'revenuecat',
    status: 'healthy',
    latencyMs: result.latencyMs,
    detailCode: null,
  };
};
