/**
 * The app's QueryClient (ADR-04, SCREEN_AND_FLOW_MAP §0.4). Queries pause while offline
 * (`networkMode: 'online'`), retry only transient failures, and stay in memory as long as the
 * persisted cache may keep them (7 days) so hydration never drops them early.
 */
import { shouldRetry } from '@da/api-client/react';
import { QueryClient } from '@tanstack/react-query';

import { CACHE_MAX_AGE_MS } from './persister';

/** `gcTime` override for tests (`Infinity` schedules no garbage-collection timer). */
export function createAppQueryClient(overrides: { readonly gcTime?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: overrides.gcTime ?? CACHE_MAX_AGE_MS,
        networkMode: 'online',
        retry: (failureCount, error) => shouldRetry(failureCount, error, 2),
      },
      mutations: { networkMode: 'online', retry: false },
    },
  });
}

let client: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  client ??= createAppQueryClient();
  return client;
}

export function setQueryClientForTests(next: QueryClient | undefined): void {
  client = next;
}
