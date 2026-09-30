/**
 * Mutation option factories for settings, privacy, support, referral and purchases
 * (T-8.19 … T-8.22; `GET /referrals/me` is `referralMeQueryOptions` in `journeys.ts`). Usable without React (`queryClient.fetchQuery` / `MutationObserver`); every
 * `[IK]` route takes an optional `idempotencyKey` that the caller reuses for every retry of one
 * user intent (a support ticket, an export request, a deletion request).
 */
import { mutationOptions } from '@tanstack/react-query';

import type { ApiClient, ApiInput } from '../api.ts';
import { isApiError } from '../errors.ts';
import { mk } from '../query-keys.ts';

/** Variables of an `[IK]` call: the request body plus the key reused for retries. */
export interface IdempotentBody<B> {
  readonly body: B;
  readonly idempotencyKey?: string;
}

function ik(idempotencyKey: string | undefined): { idempotencyKey?: string } {
  return idempotencyKey === undefined ? {} : { idempotencyKey };
}

type Body<K extends keyof BodyRoutes> = BodyRoutes[K];
interface BodyRoutes {
  'POST /notifications/test': NonNullable<ApiInput<'POST /notifications/test'>['body']>;
  'POST /support/tickets': NonNullable<ApiInput<'POST /support/tickets'>['body']>;
  'POST /feedback': NonNullable<ApiInput<'POST /feedback'>['body']>;
  'POST /privacy/export': NonNullable<ApiInput<'POST /privacy/export'>['body']>;
  'POST /privacy/delete-history': NonNullable<ApiInput<'POST /privacy/delete-history'>['body']>;
  'POST /privacy/delete-account': NonNullable<ApiInput<'POST /privacy/delete-account'>['body']>;
  'POST /referrals/apply': NonNullable<ApiInput<'POST /referrals/apply'>['body']>;
  'POST /purchases/sync': NonNullable<ApiInput<'POST /purchases/sync'>['body']>;
}

/** Transient failures only (network, timeout, retryable server codes), at most `max` times. */
function transient(failureCount: number, error: unknown, max: number): boolean {
  if (failureCount >= max || !isApiError(error)) return false;
  return error.kind === 'network' || error.kind === 'timeout' || error.retryable;
}

/** API-BIZ-01 `POST /referrals/apply`; business errors (404/409/422) are final. */
export function referralApplyMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.business.referralApply,
    mutationFn: async ({ body, idempotencyKey }: IdempotentBody<Body<'POST /referrals/apply'>>) =>
      (await client.call('POST /referrals/apply', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}

/** API-BIZ-03 `POST /purchases/sync` (after a purchase, a restore or a customer-info update). */
export function purchasesSyncMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.business.purchasesSync,
    mutationFn: async ({ body, idempotencyKey }: IdempotentBody<Body<'POST /purchases/sync'>>) =>
      (await client.call('POST /purchases/sync', { body }, ik(idempotencyKey))).data,
    retry: (failureCount, error) => transient(failureCount, error, 2),
  });
}

/** API-DEV-04 `POST /notifications/test` (3 per 10 min; never retried automatically). */
export function notificationTestMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.settings.notificationTest,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentBody<Body<'POST /notifications/test'>>) =>
      (await client.call('POST /notifications/test', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}

/** API-SUP-01 `POST /support/tickets` (the key is created when the sheet opens). */
export function supportTicketMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.settings.supportTicket,
    mutationFn: async ({ body, idempotencyKey }: IdempotentBody<Body<'POST /support/tickets'>>) =>
      (await client.call('POST /support/tickets', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}

/** API-SUP-02 `POST /feedback` (queueable offline; the replay reuses the key). */
export function feedbackMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.settings.feedback,
    mutationFn: async ({ body, idempotencyKey }: IdempotentBody<Body<'POST /feedback'>>) =>
      (await client.call('POST /feedback', { body }, ik(idempotencyKey))).data,
    retry: (failureCount, error) => transient(failureCount, error, 2),
  });
}

/** API-PRV-01 `POST /privacy/export`. */
export function privacyExportMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.privacy.export,
    mutationFn: async ({ body, idempotencyKey }: IdempotentBody<Body<'POST /privacy/export'>>) =>
      (await client.call('POST /privacy/export', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}

/** API-PRV-04 `POST /privacy/export/:id/download`: a fresh 300 s signed URL per tap. */
export function exportDownloadMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.privacy.exportDownload,
    mutationFn: async ({ id }: { readonly id: string }) =>
      (await client.call('POST /privacy/export/:id/download', { params: { id }, body: {} })).data,
    retry: false,
  });
}

/** API-PRV-02 `POST /privacy/delete-history` (needs a sign-in within 10 min, R-16). */
export function deleteHistoryMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.privacy.deleteHistory,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentBody<Body<'POST /privacy/delete-history'>>) =>
      (await client.call('POST /privacy/delete-history', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}

/** API-PRV-03 `POST /privacy/delete-account` (needs a sign-in within 10 min, R-16). */
export function deleteAccountMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.privacy.deleteAccount,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: IdempotentBody<Body<'POST /privacy/delete-account'>>) =>
      (await client.call('POST /privacy/delete-account', { body }, ik(idempotencyKey))).data,
    retry: false,
  });
}
