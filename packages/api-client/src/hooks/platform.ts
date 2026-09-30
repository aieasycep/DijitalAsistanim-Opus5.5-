/**
 * Mutation option factories for the mobile platform services (T-8.28): the analytics batch
 * delivery `POST /analytics/events` (API-ANL-01). The route has no Idempotency-Key (duplicates are
 * tolerated for analytics); the client batches at most `ANALYTICS_BATCH_MAX` events per call.
 */
import { mutationOptions } from '@tanstack/react-query';

import type { ApiClient, ApiInput } from '../api.ts';
import { mk } from '../query-keys.ts';

/** The client's batch size (the server accepts up to 100). */
export const ANALYTICS_BATCH_MAX = 50;

export type AnalyticsBatchBody = NonNullable<ApiInput<'POST /analytics/events'>['body']>;

/** API-ANL-01 `POST /analytics/events` (202 `{accepted, dropped}`). */
export function analyticsEventsMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.analytics.events,
    mutationFn: async (body: AnalyticsBatchBody) =>
      (await client.call('POST /analytics/events', { body }, { timeoutMs: 10_000 })).data,
    retry: false,
  });
}
