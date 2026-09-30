/**
 * `microsoft_oauth` probe: Entra OIDC discovery, the certificate credential's presence and its
 * `MICROSOFT_CERT_NOT_AFTER` (expired → down, fewer than 30 days → degraded).
 */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, probeFetch, timed } from './types.ts';

export const MICROSOFT_DISCOVERY_URL =
  'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration';

export const microsoftOauthProbe: Probe = async (ctx) => {
  const status = credentialStatus('microsoft_oauth', ctx.raw);
  if (status.status !== 'configured') return credentialRequired('microsoft_oauth', status.missing);
  const notAfter = Date.parse(ctx.raw.MICROSOFT_CERT_NOT_AFTER ?? '');
  const daysLeft = Number.isNaN(notAfter)
    ? null
    : Math.floor((notAfter - ctx.now().getTime()) / 86_400_000);
  if (daysLeft !== null && daysLeft < 0) {
    return {
      component: 'microsoft_oauth',
      status: 'down',
      latencyMs: null,
      detailCode: 'certificate_expired',
      detail: { days_left: daysLeft },
    };
  }
  const result = await timed(ctx, () => probeFetch(ctx, MICROSOFT_DISCOVERY_URL));
  if (!result.ok || result.value !== 200) {
    return {
      component: 'microsoft_oauth',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'discovery_failed',
    };
  }
  const expiring = daysLeft !== null && daysLeft < 30;
  return {
    component: 'microsoft_oauth',
    status: expiring ? 'degraded' : 'healthy',
    latencyMs: result.latencyMs,
    detailCode: expiring
      ? 'certificate_expiring'
      : daysLeft === null
        ? 'certificate_expiry_unknown'
        : null,
    detail: { days_left: daysLeft },
  };
};
