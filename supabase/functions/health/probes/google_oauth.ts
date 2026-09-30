/**
 * `google_oauth` probe: Google OIDC discovery plus the presence of the web client credentials, and
 * the verification status of KPL-32. While the OAuth app is unverified (`google.oauth_verified`
 * false, or the CASA letter `GOOGLE_CASA_LOA_NOT_AFTER` expired) Google caps restricted-scope use at
 * 100 users: the probe counts distinct users with a connected Gmail account, records
 * `detail {verified:false, gmail_users, cap:100}` and turns `degraded` at 80 users and `down` at
 * 95; the detail code tells the backoffice which notice to show.
 */
import { credentialStatus } from '../../_shared/env.ts';
import {
  GMAIL_CAP_DEGRADED_AT,
  GMAIL_CAP_DOWN_AT,
  GMAIL_UNVERIFIED_CAP,
  googleOauthVerified,
} from '../../_shared/services/google-verification.ts';
import { credentialRequired, type Probe, probeFetch, type ProbeResult, timed } from './types.ts';

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
  let google: { setting: unknown; gmailUsers: number };
  try {
    google = await ctx.data.googleOauth();
  } catch {
    return {
      component: 'google_oauth',
      status: 'unknown',
      latencyMs: result.latencyMs,
      detailCode: 'verification_unknown',
    };
  }
  if (googleOauthVerified(google.setting, ctx.raw.GOOGLE_CASA_LOA_NOT_AFTER, ctx.now())) {
    return {
      component: 'google_oauth',
      status: 'healthy',
      latencyMs: result.latencyMs,
      detailCode: null,
      detail: { verified: true },
    };
  }
  const users = google.gmailUsers;
  const capStatus: ProbeResult['status'] =
    users >= GMAIL_CAP_DOWN_AT ? 'down' : users >= GMAIL_CAP_DEGRADED_AT ? 'degraded' : 'healthy';
  return {
    component: 'google_oauth',
    status: capStatus,
    latencyMs: result.latencyMs,
    detailCode:
      capStatus === 'down'
        ? 'google_unverified_cap_reached'
        : capStatus === 'degraded'
          ? 'google_unverified_cap_near'
          : 'google_unverified',
    detail: { verified: false, gmail_users: users, cap: GMAIL_UNVERIFIED_CAP },
  };
};
