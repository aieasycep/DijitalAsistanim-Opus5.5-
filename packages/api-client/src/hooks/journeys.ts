/**
 * Query and mutation option factories for onboarding, integrations and briefings (T-8.06, T-8.07,
 * T-8.09). Usable without React (`queryClient.fetchQuery` / `MutationObserver`); `[IK]` routes take
 * an optional `idempotencyKey` reused for every retry of one user intent.
 */
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import type { ApiClient, ApiData, ApiInput } from '../api.ts';
import { isApiError } from '../errors.ts';
import { mk, qk } from '../query-keys.ts';

/** Variables of an `[IK]` call: the request parts plus the key reused for retries. */
export interface IdempotentCall<I> {
  readonly input: I;
  readonly idempotencyKey?: string;
}

function ik(idempotencyKey: string | undefined): { idempotencyKey?: string } {
  return idempotencyKey === undefined ? {} : { idempotencyKey };
}

/** Transient failures only (network, timeout, retryable server codes), at most `max` times. */
function transient(failureCount: number, error: unknown, max: number): boolean {
  if (failureCount >= max || !isApiError(error)) return false;
  return error.kind === 'network' || error.kind === 'timeout' || error.retryable;
}

/** API-INT-01 `POST /integrations/:provider/start` (R-07: carries `device_nonce_hash`). */
export function integrationStartMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.start,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /integrations/:provider/start'>>) =>
      (await client.call('POST /integrations/:provider/start', input, ik(idempotencyKey))).data,
  });
}

/** API-INT-02 `POST /integrations/:accountId/upgrade` (progressive consent). */
export function integrationUpgradeMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.upgrade,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /integrations/:accountId/upgrade'>>) =>
      (await client.call('POST /integrations/:accountId/upgrade', input, ik(idempotencyKey))).data,
  });
}

/** API-INT-07 `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07). */
export function oauthCompleteMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.complete,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /integrations/oauth/complete'>>) =>
      (await client.call('POST /integrations/oauth/complete', input, ik(idempotencyKey))).data,
    // A completion code is single use: never retried automatically.
    retry: false,
  });
}

/** API-INT-03 `POST /integrations/:accountId/disconnect`. */
export function integrationDisconnectMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.disconnect,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /integrations/:accountId/disconnect'>>) =>
      (await client.call('POST /integrations/:accountId/disconnect', input, ik(idempotencyKey)))
        .data,
  });
}

/** API-INT-04 `POST /integrations/:accountId/sync` (server rate limit 1/60 s per account). */
export function integrationSyncMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.sync,
    mutationFn: async (input: ApiInput<'POST /integrations/:accountId/sync'>) =>
      (await client.call('POST /integrations/:accountId/sync', input)).data,
  });
}

/** API-INT-05 `PATCH /integrations/:accountId/data-sources` (toggles and calendar selection). */
export function dataSourcesMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.dataSources,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'PATCH /integrations/:accountId/data-sources'>>) =>
      (await client.call('PATCH /integrations/:accountId/data-sources', input, ik(idempotencyKey)))
        .data,
  });
}

/** API-INT-06 `POST /integrations/device-calendar/snapshot`. */
export function deviceSnapshotMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.integrations.deviceSnapshot,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /integrations/device-calendar/snapshot'>>) =>
      (await client.call('POST /integrations/device-calendar/snapshot', input, ik(idempotencyKey)))
        .data,
  });
}

/** API-ONB-01 `POST /onboarding/first-analysis` (one job per user; a replay returns it). */
export function firstAnalysisStartMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.onboarding.firstAnalysis,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /onboarding/first-analysis'>>) =>
      (await client.call('POST /onboarding/first-analysis', input, ik(idempotencyKey))).data,
  });
}

/** API-ONB-02 poll interval while the job runs (SCREEN_AND_FLOW_MAP §0.4, R-19). */
export const FIRST_ANALYSIS_POLL_MS = 1_500;

/** API-ONB-02 `GET /onboarding/first-analysis/:jobId`: polled every 1.5 s until terminal. */
export function firstAnalysisQueryOptions(client: ApiClient, jobId: string) {
  return queryOptions({
    queryKey: qk.onboarding.firstAnalysis(jobId),
    queryFn: async ({ signal }): Promise<ApiData<'GET /onboarding/first-analysis/:jobId'>> =>
      (
        await client.call(
          'GET /onboarding/first-analysis/:jobId',
          { params: { jobId } },
          { signal },
        )
      ).data,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : FIRST_ANALYSIS_POLL_MS;
    },
    retry: (failureCount, error) => transient(failureCount, error, 3),
  });
}

/** Signed audio URLs live 300 s; the query stays fresh for 240 s (§0.4). */
export const BRIEFING_AUDIO_STALE_MS = 240_000;

/** API-BRF-01 `POST /briefings/:id/audio` (idempotent; used as a query). */
export function briefingAudioQueryOptions(
  client: ApiClient,
  briefingId: string,
  prefer: 'premium' | 'native' = 'premium',
) {
  return queryOptions({
    queryKey: [...qk.briefings.audio(briefingId), prefer] as const,
    queryFn: async ({ signal }): Promise<ApiData<'POST /briefings/:id/audio'>> =>
      (
        await client.call(
          'POST /briefings/:id/audio',
          { params: { id: briefingId }, body: { prefer } },
          { signal },
        )
      ).data,
    staleTime: BRIEFING_AUDIO_STALE_MS,
    retry: (failureCount, error) => transient(failureCount, error, 1),
  });
}

/** API-BRF-02 `POST /briefings/:id/evening-ready` (key `evening_ready:{briefing_id}`). */
export function eveningReadyMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.briefings.eveningReady,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /briefings/:id/evening-ready'>>) =>
      (await client.call('POST /briefings/:id/evening-ready', input, ik(idempotencyKey))).data,
  });
}

/** API-BRF-04 `POST /briefings/:id/retry`. */
export function briefingRetryMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.briefings.retry,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentCall<ApiInput<'POST /briefings/:id/retry'>>) =>
      (await client.call('POST /briefings/:id/retry', input, ik(idempotencyKey))).data,
  });
}

/** API-BRF-03 `GET /weekly/:id/share-card` (aggregates only; persisted, 10 min). */
export function shareCardQueryOptions(client: ApiClient, weeklyId: string) {
  return queryOptions({
    queryKey: qk.weekly.shareCard(weeklyId),
    queryFn: async ({ signal }): Promise<ApiData<'GET /weekly/:id/share-card'>> =>
      (await client.call('GET /weekly/:id/share-card', { params: { id: weeklyId } }, { signal }))
        .data,
    staleTime: 10 * 60_000,
    meta: { persist: true },
    retry: (failureCount, error) => transient(failureCount, error, 2),
  });
}

/** API-BIZ-02 `GET /referrals/me` (the optional invite link on the share card). */
export function referralMeQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: qk.referrals.me(),
    queryFn: async ({ signal }): Promise<ApiData<'GET /referrals/me'>> =>
      (await client.call('GET /referrals/me', {}, { signal })).data,
    staleTime: 10 * 60_000,
    meta: { persist: true },
    retry: (failureCount, error) => transient(failureCount, error, 2),
  });
}
