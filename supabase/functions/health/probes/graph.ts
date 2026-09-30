/**
 * `microsoft_graph` probe: Graph `$metadata` reachable, the share of Microsoft accounts in an error
 * state and change-notification recency (same thresholds as `gmail`). Needs the Entra app.
 */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, type ProbeResult, probeFetch, timed } from './types.ts';

export const GRAPH_METADATA_URL = 'https://graph.microsoft.com/v1.0/$metadata';

export const graphProbe: Probe = async (ctx): Promise<ProbeResult> => {
  const missing = [
    ...credentialStatus('microsoft_oauth', ctx.raw).missing,
    ...credentialStatus('microsoft_graph_webhook', ctx.raw).missing,
  ];
  if (missing.length > 0) return credentialRequired('microsoft_graph', missing);
  const result = await timed(ctx, () => probeFetch(ctx, GRAPH_METADATA_URL));
  if (!result.ok || result.value !== 200) {
    return {
      component: 'microsoft_graph',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'api_unreachable',
    };
  }
  try {
    const accounts = await ctx.data.accountHealth('microsoft');
    const ratio = accounts.total === 0 ? 0 : accounts.failing / accounts.total;
    const notifications = await ctx.data.webhookStats(
      'microsoft_graph',
      new Date(ctx.now().getTime() - 30 * 60_000),
    );
    const silent = accounts.total > 0 && notifications.total === 0;
    const status = ratio > 0.5 ? 'down' : ratio > 0.05 || silent ? 'degraded' : 'healthy';
    return {
      component: 'microsoft_graph',
      status,
      latencyMs: result.latencyMs,
      detailCode:
        status === 'healthy'
          ? null
          : silent && ratio <= 0.05
            ? 'no_recent_notification'
            : 'account_errors',
      detail: { accounts: accounts.total, failing_accounts: accounts.failing },
    };
  } catch {
    return {
      component: 'microsoft_graph',
      status: 'unknown',
      latencyMs: result.latencyMs,
      detailCode: 'stats_unavailable',
    };
  }
};
