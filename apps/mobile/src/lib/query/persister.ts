/**
 * Persisted query cache (M-GL-01 provider 6, SECURITY_AND_PRIVACY_PLAN CTL-3.13): the TanStack
 * async-storage persister over the AES-256 MMKV store `da-cache` (never AsyncStorage). Only queries
 * that opt in with `meta.persist === true` and succeeded are written — mail originals, assistant
 * streams, drafts and privacy statuses never opt in. Max age 7 days; the buster invalidates the
 * cache on every app version and cache-schema change. Logout clears the query cache and wipes
 * `da-cache` (`logout.ts`).
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';
import type { MMKV } from 'react-native-mmkv';

export const CACHE_SCHEMA_VERSION = 1;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_STORAGE_KEY = 'da.query-cache';

/** The async-storage interface the persister expects, backed by one MMKV store. */
export function mmkvAsyncStorage(store: MMKV) {
  return {
    getItem: (key: string) => Promise.resolve(store.getString(key) ?? null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      store.remove(key);
      return Promise.resolve();
    },
  };
}

export function createCachePersister(store: MMKV): Persister {
  return createAsyncStoragePersister({
    storage: mmkvAsyncStorage(store),
    key: CACHE_STORAGE_KEY,
    throttleTime: 1000,
  });
}

/** Only successful queries that opted in (`meta: { persist: true }`). */
export function shouldPersistQuery(query: Query): boolean {
  return query.meta?.persist === true && query.state.status === 'success';
}

export function cacheBuster(appVersion: string): string {
  return `${appVersion}:${String(CACHE_SCHEMA_VERSION)}`;
}
