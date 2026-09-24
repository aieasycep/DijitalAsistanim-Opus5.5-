/**
 * `webhooks` probe: per source (Gmail Pub/Sub, Calendar channels, Graph, RevenueCat) the secret must
 * be configured, the last hour's signature failures must stay ≤ 1 % and nothing may wait in the
 * processing backlog. Any unconfigured source makes the component `external_credential_required`.
 */
import { credentialStatus, type CredentialName } from '../../_shared/env.ts';
import type { Probe } from './types.ts';

const SOURCES: readonly { source: string; credentials: readonly CredentialName[] }[] = [
  { source: 'google_gmail', credentials: ['google_oauth', 'google_pubsub'] },
  { source: 'google_calendar', credentials: ['google_oauth', 'google_calendar_webhook'] },
  { source: 'microsoft_graph', credentials: ['microsoft_oauth', 'microsoft_graph_webhook'] },
  { source: 'revenuecat', credentials: ['revenuecat_webhook'] },
];

export const webhooksProbe: Probe = async (ctx) => {
  const missing = new Set<string>();
  for (const { credentials } of SOURCES) {
    for (const name of credentials)
      for (const key of credentialStatus(name, ctx.raw).missing) missing.add(key);
  }
  if (missing.size > 0) {
    return {
      component: 'webhooks',
      status: 'external_credential_required',
      latencyMs: null,
      detailCode: 'credential_missing',
      detail: { credential_keys: [...missing].sort() },
    };
  }
  const since = new Date(ctx.now().getTime() - 60 * 60_000);
  let degraded = false;
  let down = false;
  const detail: Record<string, number> = {};
  try {
    for (const { source } of SOURCES) {
      const stats = await ctx.data.webhookStats(source, since);
      const ratio = stats.total === 0 ? 0 : stats.rejected / stats.total;
      detail[`${source}_rejected_pct`] = Math.round(ratio * 1000) / 10;
      detail[`${source}_backlog`] = stats.backlog;
      if (ratio > 0.01) degraded = true;
      if (stats.backlog > 0) degraded = true;
    }
  } catch {
    down = true;
  }
  return {
    component: 'webhooks',
    status: down ? 'unknown' : degraded ? 'degraded' : 'healthy',
    latencyMs: null,
    detailCode: down ? 'stats_unavailable' : degraded ? 'signature_failures_or_backlog' : null,
    detail,
  };
};
