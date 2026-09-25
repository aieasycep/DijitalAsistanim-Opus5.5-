/**
 * Widget snapshot (T-8.25; API-WDG-01 `GET /widgets/snapshot`). The mobile widget bridge fetches it
 * imperatively (`fetchWidgetSnapshot`) and writes it to the App Group / Glance store; the query
 * factory serves screens that want to preview what the widgets show. The query is never persisted
 * (no `meta.persist`) and is garbage-collected at once: the store, not the cache, is the copy.
 */
import { queryOptions } from '@tanstack/react-query';

import type { ApiClient, ApiData } from '../api.ts';
import { qk } from '../query-keys.ts';

/** The widget refresh gives up after 10 s; the next trigger retries. */
export const WIDGET_SNAPSHOT_TIMEOUT_MS = 10_000;

export async function fetchWidgetSnapshot(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ApiData<'GET /widgets/snapshot'>> {
  const options = {
    timeoutMs: WIDGET_SNAPSHOT_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  };
  return (await client.call('GET /widgets/snapshot', {}, options)).data;
}

export function widgetSnapshotQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: qk.widgets.snapshot(),
    queryFn: ({ signal }) => fetchWidgetSnapshot(client, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
