/** `supabase_auth` probe: `GET ${SUPABASE_URL}/auth/v1/health` (degraded on a non-200 answer). */
import { supabaseRuntimeKeys } from '../../_shared/env.ts';
import { type Probe, probeFetch, timed } from './types.ts';

export const authProbe: Probe = async (ctx) => {
  const url = ctx.raw.SUPABASE_URL?.trim();
  if (url === undefined || url === '') {
    return {
      component: 'supabase_auth',
      status: 'down',
      latencyMs: null,
      detailCode: 'supabase_url_missing',
    };
  }
  const key = supabaseRuntimeKeys(ctx.raw, url).publishableKey;
  const result = await timed(ctx, () =>
    probeFetch(
      ctx,
      `${url.replace(/\/+$/, '')}/auth/v1/health`,
      key === null ? {} : { headers: { apikey: key } },
    ),
  );
  if (!result.ok)
    return {
      component: 'supabase_auth',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'unreachable',
    };
  if (result.value !== 200) {
    return {
      component: 'supabase_auth',
      status: 'degraded',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  }
  return {
    component: 'supabase_auth',
    status: 'healthy',
    latencyMs: result.latencyMs,
    detailCode: null,
  };
};
