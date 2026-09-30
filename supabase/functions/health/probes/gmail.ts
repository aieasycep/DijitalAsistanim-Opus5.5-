/**
 * `gmail` probe: Gmail API discovery reachable, the share of Google accounts in an error state
 * (> 5 % degraded, > 50 % down) and Pub/Sub delivery recency (no push for 30 min while accounts are
 * connected → degraded). Needs the Google OAuth client and the Pub/Sub topic.
 */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, type ProbeResult, probeFetch, timed } from './types.ts';

export const GMAIL_DISCOVERY_URL = 'https://gmail.googleapis.com/$discovery/rest?version=v1';

export const gmailProbe: Probe = async (ctx): Promise<ProbeResult> => {
  const missing = [
    ...credentialStatus('google_oauth', ctx.raw).missing,
    ...credentialStatus('google_pubsub', ctx.raw).missing,
  ];
  if (missing.length > 0) return credentialRequired('gmail', missing);
  const result = await timed(ctx, () => probeFetch(ctx, GMAIL_DISCOVERY_URL));
  if (!result.ok || result.value !== 200) {
    return {
      component: 'gmail',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'api_unreachable',
    };
  }
  try {
    const accounts = await ctx.data.accountHealth('google');
    const ratio = accounts.total === 0 ? 0 : accounts.failing / accounts.total;
    const push = await ctx.data.webhookStats(
      'google_gmail',
      new Date(ctx.now().getTime() - 30 * 60_000),
    );
    const silent = accounts.total > 0 && push.total === 0;
    const status = ratio > 0.5 ? 'down' : ratio > 0.05 || silent ? 'degraded' : 'healthy';
    return {
      component: 'gmail',
      status,
      latencyMs: result.latencyMs,
      detailCode:
        status === 'healthy' ? null : silent && ratio <= 0.05 ? 'no_recent_push' : 'account_errors',
      detail: { accounts: accounts.total, failing_accounts: accounts.failing },
    };
  } catch {
    return {
      component: 'gmail',
      status: 'unknown',
      latencyMs: result.latencyMs,
      detailCode: 'stats_unavailable',
    };
  }
};
