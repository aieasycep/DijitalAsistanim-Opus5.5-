/**
 * `email_delivery` probe (BACKOFFICE_PLAN §11): an authenticated read on the transactional e-mail
 * provider. Its component is not yet accepted by `system_health_checks.component`, so the result is
 * logged by `/health/run` and persisted once the DB check lists it (BACKOFFICE_PLAN §16 #21).
 */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, probeFetch, timed } from './types.ts';

const ENDPOINTS: Readonly<
  Record<string, (key: string) => { url: string; headers: Record<string, string> }>
> = {
  postmark: (key) => ({
    url: 'https://api.postmarkapp.com/server',
    headers: { 'X-Postmark-Server-Token': key, Accept: 'application/json' },
  }),
  resend: (key) => ({
    url: 'https://api.resend.com/domains',
    headers: { Authorization: `Bearer ${key}` },
  }),
};

export const emailDeliveryProbe: Probe = async (ctx) => {
  const status = credentialStatus('email_delivery', ctx.raw);
  if (status.status !== 'configured') return credentialRequired('email_delivery', status.missing);
  const provider = ctx.raw.EMAIL_PROVIDER?.trim() ?? '';
  const endpoint = ENDPOINTS[provider];
  if (endpoint === undefined) {
    return {
      component: 'email_delivery',
      status: 'unknown',
      latencyMs: null,
      detailCode: 'provider_not_probed',
      detail: { provider },
    };
  }
  const { url, headers } = endpoint(ctx.raw.EMAIL_API_KEY?.trim() ?? '');
  const result = await timed(ctx, () => probeFetch(ctx, url, { headers }));
  if (!result.ok)
    return {
      component: 'email_delivery',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'unreachable',
    };
  if (result.value !== 200) {
    return {
      component: 'email_delivery',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  }
  return {
    component: 'email_delivery',
    status: 'healthy',
    latencyMs: result.latencyMs,
    detailCode: null,
  };
};
