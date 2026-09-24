/** `push` probe: Expo `getReceipts {ids:[]}` with the access token (enhanced push security). */
import { credentialStatus } from '../../_shared/env.ts';
import { credentialRequired, type Probe, probeFetch, timed } from './types.ts';

export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export const pushProbe: Probe = async (ctx) => {
  const status = credentialStatus('expo_push', ctx.raw);
  if (status.status !== 'configured') return credentialRequired('push', status.missing);
  const token = ctx.raw.EXPO_ACCESS_TOKEN?.trim() ?? '';
  const result = await timed(ctx, () =>
    probeFetch(ctx, EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ids: [] }),
    }),
  );
  if (!result.ok)
    return {
      component: 'push',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: 'unreachable',
    };
  if (result.value !== 200)
    return {
      component: 'push',
      status: 'down',
      latencyMs: result.latencyMs,
      detailCode: `http_${result.value}`,
    };
  return { component: 'push', status: 'healthy', latencyMs: result.latencyMs, detailCode: null };
};
