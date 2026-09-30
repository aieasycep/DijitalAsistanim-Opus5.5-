import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createApiClient, mk } from '../src/index.ts';
import { ANALYTICS_BATCH_MAX, analyticsEventsMutationOptions } from '../src/hooks/index.ts';
import { TS, json, mockFetch, ok, uuid } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

describe('analytics delivery (API-ANL-01)', () => {
  it('posts one batch without an idempotency key and returns the counts', async () => {
    const mock = mockFetch(() => json(202, ok({ accepted: 2, dropped: 0 })));
    const options = analyticsEventsMutationOptions(api(mock.fn));
    expect(options.mutationKey).toEqual(mk.analytics.events);
    const body = {
      session_id: uuid(1),
      events: [
        { name: 'app_opened', ts: TS, props: { source: 'cold' } },
        { name: 'tab_selected', ts: TS, screen: 'M-TD-01', props: { tab: 'flow' } },
      ],
    };
    const result = await new MutationObserver(new QueryClient(), options).mutate(body);
    expect(result).toEqual({ accepted: 2, dropped: 0 });
    const call = mock.calls[0];
    expect(call?.url).toBe('https://api.example.com/functions/v1/api/analytics/events');
    expect(call?.init.method).toBe('POST');
    expect(call?.headers['idempotency-key']).toBeUndefined();
    expect(JSON.parse(call?.init.body as string)).toEqual(body);
  });

  it('keeps client batches within the server limit', () => {
    expect(ANALYTICS_BATCH_MAX).toBe(50);
  });
});
