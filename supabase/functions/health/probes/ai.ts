/**
 * `ai_anthropic`, `ai_openai`, `ai_voyage` probes: `GET /v1/models` (no tokens consumed) plus the
 * provider's error rate over 15 minutes from `ai_requests` (< 5 % healthy, 5–25 % degraded, > 25 %
 * down). Voyage embeds one fixed word with the configured `embedding_query` model and checks the
 * vector length. A missing key is `external_credential_required`.
 */
import { credentialStatus } from '../../_shared/env.ts';
import {
  credentialRequired,
  type HealthStatus,
  type ProbeContext,
  type ProbeResult,
  probeFetch,
  timed,
} from './types.ts';

function rateStatus(total: number, errors: number): { status: HealthStatus; pct: number } {
  const ratio = total === 0 ? 0 : errors / total;
  return {
    status: ratio > 0.25 ? 'down' : ratio >= 0.05 ? 'degraded' : 'healthy',
    pct: Math.round(ratio * 1000) / 10,
  };
}

async function modelsProbe(
  ctx: ProbeContext,
  component: 'ai_anthropic' | 'ai_openai',
  provider: 'anthropic' | 'openai',
): Promise<ProbeResult> {
  const status = credentialStatus(provider, ctx.raw);
  if (status.status !== 'configured') return credentialRequired(component, status.missing);
  const key =
    (provider === 'anthropic' ? ctx.raw.ANTHROPIC_API_KEY : ctx.raw.OPENAI_API_KEY)?.trim() ?? '';
  const url =
    provider === 'anthropic'
      ? 'https://api.anthropic.com/v1/models?limit=1'
      : 'https://api.openai.com/v1/models';
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${key}` };
  const result = await timed(ctx, () => probeFetch(ctx, url, { headers }));
  if (!result.ok)
    return { component, status: 'down', latencyMs: result.latencyMs, detailCode: 'unreachable' };
  if (result.value !== 200)
    return {
      component,
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  let rate: { status: HealthStatus; pct: number } = { status: 'healthy', pct: 0 };
  try {
    const stats = await ctx.data.aiErrorRate(provider, new Date(ctx.now().getTime() - 15 * 60_000));
    rate = rateStatus(stats.total, stats.errors);
  } catch {
    rate = { status: 'unknown', pct: 0 };
  }
  return {
    component,
    status: rate.status,
    latencyMs: result.latencyMs,
    detailCode:
      rate.status === 'healthy'
        ? null
        : rate.status === 'unknown'
          ? 'stats_unavailable'
          : 'error_rate',
    detail: { error_rate_pct: rate.pct },
  };
}

async function voyageProbe(ctx: ProbeContext): Promise<ProbeResult> {
  const status = credentialStatus('voyage', ctx.raw);
  if (status.status !== 'configured') return credentialRequired('ai_voyage', status.missing);
  let model: string | null;
  try {
    model = await ctx.data.embeddingQueryModel();
  } catch {
    model = null;
  }
  if (model === null)
    return {
      component: 'ai_voyage',
      status: 'unknown',
      latencyMs: null,
      detailCode: 'not_configured',
    };
  const key = ctx.raw.VOYAGE_API_KEY?.trim() ?? '';
  const started = ctx.now().getTime();
  try {
    const response = await ctx.fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: ['sağlık'],
        input_type: 'query',
        output_dimension: 1024,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    const latencyMs = ctx.now().getTime() - started;
    if (!response.ok) {
      await response.body?.cancel();
      return {
        component: 'ai_voyage',
        status: 'down',
        latencyMs,
        detailCode: `http_${response.status}`,
      };
    }
    const json = (await response.json()) as { data?: { embedding?: number[] }[] };
    const dims = json.data?.[0]?.embedding?.length ?? 0;
    if (dims !== 1024)
      return {
        component: 'ai_voyage',
        status: 'down',
        latencyMs,
        detailCode: 'wrong_dimension',
        detail: { dimensions: dims },
      };
    return { component: 'ai_voyage', status: 'healthy', latencyMs, detailCode: null };
  } catch {
    return {
      component: 'ai_voyage',
      status: 'down',
      latencyMs: ctx.now().getTime() - started,
      detailCode: 'unreachable',
    };
  }
}

export async function aiProbes(ctx: ProbeContext): Promise<ProbeResult[]> {
  return await Promise.all([
    modelsProbe(ctx, 'ai_anthropic', 'anthropic'),
    modelsProbe(ctx, 'ai_openai', 'openai'),
    voyageProbe(ctx),
  ]);
}
