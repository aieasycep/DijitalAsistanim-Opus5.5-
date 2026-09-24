/**
 * TanStack Query with the persisted cache (M-GL-01 provider 6): the encrypted `da-cache` MMKV
 * persister, `meta.persist` queries only, 7-day max age, buster = app version + cache schema.
 * After hydration, paused mutations resume (T-8.23 registers their defaults). The API client is
 * provided to `@da/api-client/react` hooks here.
 */
import { ApiClientProvider } from '@da/api-client/react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useState, type ReactNode } from 'react';

import { getApiClient } from '../lib/bootstrap';
import { appVersion } from '../lib/device';
import { getQueryClient } from '../lib/query/client';
import {
  CACHE_MAX_AGE_MS,
  cacheBuster,
  createCachePersister,
  shouldPersistQuery,
} from '../lib/query/persister';
import { encryptedStorage } from '../lib/storage';

export function QueryProvider({ children }: { readonly children: ReactNode }) {
  const [client] = useState(getQueryClient);
  const [persister] = useState(() => createCachePersister(encryptedStorage().cache));
  const [api] = useState(getApiClient);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster: cacheBuster(appVersion()),
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
      onSuccess={() => {
        void client.resumePausedMutations();
      }}
    >
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </PersistQueryClientProvider>
  );
}
