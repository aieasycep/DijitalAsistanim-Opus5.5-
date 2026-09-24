/**
 * `@da/api-client/react`: TanStack Query v5 bindings. The core client stays React-free; this
 * subpath adds the client context, query/mutation option factories (usable without React through
 * `queryClient.fetchQuery` / `MutationObserver`) and thin hooks. Feature hooks are added per
 * feature next to these.
 */
import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createContext, createElement, useContext, type ReactNode } from 'react';

import type { ApiClient, ApiData, ApiInput } from '../api.ts';
import { isApiError } from '../errors.ts';
import { mk, qk } from '../query-keys.ts';

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  readonly client: ApiClient;
  readonly children?: ReactNode;
}

export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return createElement(ApiClientContext.Provider, { value: client }, children);
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) throw new Error('useApiClient() needs an <ApiClientProvider>.');
  return client;
}

/** 5 min (SCREEN_AND_FLOW_MAP §0.4). */
export const BOOTSTRAP_STALE_TIME_MS = 5 * 60_000;
/** API-BOOT-01 client retry: 3 attempts after 0.5, 2 and 8 s. */
export const BOOTSTRAP_RETRY_DELAYS_MS = [500, 2_000, 8_000] as const;

/** Retries only transient failures (network, timeout, retryable server codes), `max` times. */
export function shouldRetry(failureCount: number, error: unknown, max: number): boolean {
  if (failureCount >= max) return false;
  if (!isApiError(error)) return false;
  return error.kind === 'network' || error.kind === 'timeout' || error.retryable;
}

function retryDelay(attempt: number): number {
  return BOOTSTRAP_RETRY_DELAYS_MS[Math.min(attempt, BOOTSTRAP_RETRY_DELAYS_MS.length - 1)] ?? 0;
}

/** `GET /me/bootstrap` (persisted: `meta.persist`). */
export function bootstrapQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: qk.me.bootstrap(),
    queryFn: async ({ signal }): Promise<ApiData<'GET /me/bootstrap'>> =>
      (await client.call('GET /me/bootstrap', {}, { signal })).data,
    staleTime: BOOTSTRAP_STALE_TIME_MS,
    meta: { persist: true },
    retry: (failureCount, error) => shouldRetry(failureCount, error, 3),
    retryDelay,
  });
}

/** `GET /me/entitlements` (persisted). */
export function entitlementsQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: qk.me.entitlements(),
    queryFn: async ({ signal }): Promise<ApiData<'GET /me/entitlements'>> =>
      (await client.call('GET /me/entitlements', {}, { signal })).data,
    staleTime: BOOTSTRAP_STALE_TIME_MS,
    meta: { persist: true },
    retry: (failureCount, error) => shouldRetry(failureCount, error, 3),
    retryDelay,
  });
}

/** Variables of an `[IK]` mutation: the body plus the key reused for every retry of the intent. */
export interface IdempotentVariables<B> {
  readonly body: B;
  readonly idempotencyKey?: string;
}

type BodyOf<
  K extends 'POST /devices/register' | 'POST /devices/unregister' | 'POST /auth/apple/exchange',
> = NonNullable<ApiInput<K>['body']>;

export function registerDeviceMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.devices.register,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentVariables<BodyOf<'POST /devices/register'>>) =>
      (
        await client.call(
          'POST /devices/register',
          { body },
          idempotencyKey === undefined ? {} : { idempotencyKey },
        )
      ).data,
  });
}

export function unregisterDeviceMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.devices.unregister,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentVariables<BodyOf<'POST /devices/unregister'>>) =>
      (
        await client.call(
          'POST /devices/unregister',
          { body },
          idempotencyKey === undefined ? {} : { idempotencyKey },
        )
      ).data,
  });
}

export function appleExchangeMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.auth.appleExchange,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentVariables<BodyOf<'POST /auth/apple/exchange'>>) =>
      (
        await client.call(
          'POST /auth/apple/exchange',
          { body },
          idempotencyKey === undefined ? {} : { idempotencyKey },
        )
      ).data,
    // The authorization code is single use and valid 5 min: one retry (API-DEV-03).
    retry: (failureCount, error) => shouldRetry(failureCount, error, 1),
  });
}

export function useBootstrap(options: { readonly enabled?: boolean } = {}) {
  const client = useApiClient();
  return useQuery({ ...bootstrapQueryOptions(client), enabled: options.enabled ?? true });
}

export function useEntitlements(options: { readonly enabled?: boolean } = {}) {
  const client = useApiClient();
  return useQuery({ ...entitlementsQueryOptions(client), enabled: options.enabled ?? true });
}

/** Registers the installation, then refreshes bootstrap (timezone and push state may change). */
export function useRegisterDevice() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...registerDeviceMutationOptions(client),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() }),
  });
}

export function useUnregisterDevice() {
  const client = useApiClient();
  return useMutation(unregisterDeviceMutationOptions(client));
}

export function useAppleExchange() {
  const client = useApiClient();
  return useMutation(appleExchangeMutationOptions(client));
}

export * from './journeys.ts';
export * from './settings.ts';
// T-8.10…T-8.14 option factories (flow, mail, reply, approvals, plan, meetings).
export * from './actions.ts';
export * from './assist.ts';
// T-8.26 Android Notification Intelligence (signal upload).
export * from './android-ni.ts';
// T-8.23…T-8.28 platform services (analytics delivery).
export * from './platform.ts';
