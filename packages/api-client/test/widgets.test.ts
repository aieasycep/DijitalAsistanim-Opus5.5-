import { QueryClient } from '@tanstack/react-query';
import { signedOutWidgetSnapshot } from '@da/validation/widget-snapshot';
import { describe, expect, it } from 'vitest';

import { createApiClient } from '../src/api.ts';
import { ApiError } from '../src/errors.ts';
import {
  WIDGET_SNAPSHOT_TIMEOUT_MS,
  fetchWidgetSnapshot,
  widgetSnapshotQueryOptions,
} from '../src/hooks/index.ts';
import { qk } from '../src/query-keys.ts';
import { TS, json, mockFetch, ok } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

const snapshot = signedOutWidgetSnapshot(new Date(TS), 'tr');

describe('widget snapshot (API-WDG-01, T-8.25)', () => {
  it('fetches GET /widgets/snapshot and validates it as WidgetSnapshotV1', async () => {
    const mock = mockFetch(() => json(200, ok({ ...snapshot, state: 'no_sources' })));
    const data = await fetchWidgetSnapshot(api(mock.fn));
    expect(data.state).toBe('no_sources');
    expect(mock.calls[0]?.url).toBe('https://api.example.com/functions/v1/api/widgets/snapshot');
    expect(mock.calls[0]?.init.method).toBe('GET');
    expect(WIDGET_SNAPSHOT_TIMEOUT_MS).toBe(10_000);
  });

  it('rejects a snapshot that carries content outside the schema', async () => {
    const leaky = { ...snapshot, state: 'ok', priorities: [{ body: 'Merhaba' }] };
    const mock = mockFetch(() => json(200, ok(leaky)));
    await expect(fetchWidgetSnapshot(api(mock.fn))).rejects.toBeInstanceOf(ApiError);
  });

  it('exposes a non-persisted, non-retried query', async () => {
    const mock = mockFetch(() => json(200, ok(snapshot)));
    const options = widgetSnapshotQueryOptions(api(mock.fn));
    expect(options.queryKey).toEqual(qk.widgets.snapshot());
    expect(options.queryKey).toEqual(['widgets', 'snapshot']);
    expect(options.gcTime).toBe(0);
    expect(options.retry).toBe(false);
    expect(options.meta).toBeUndefined();
    const data = await new QueryClient().query(options);
    expect(data.etag).toBe('signed_out');
  });
});
