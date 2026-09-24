/** `google_oauth` probe: Google OIDC discovery plus the presence of the web client credentials. */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, probeFetch, timed } from './types.ts';

export const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';

export const googleOauthProbe: Probe = async (ctx) => {
  const status = credentialStatus('google_oauth', ctx.raw);
  if (status.status !== 'configured') return credentialRequired('google_oauth', status.missing);
  const result = await timed(ctx, () => probeFetch(ctx, GOOGLE_DISCOVERY_URL));
  if (!result.ok || result.value !== 200) {
    return {
      component: 'google_oauth',
      status: 'degraded',
      latencyMs: result.latencyMs,
      detailCode: 'discovery_failed',
    };
  }
  return {
    component: 'google_oauth',
    status: 'healthy',
    latencyMs: result.latencyMs,
    detailCode: null,
  };
};
