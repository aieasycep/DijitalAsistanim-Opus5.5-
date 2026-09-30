/**
 * Query and mutation option factories for the assistant, search, approvals, reminders and captures
 * (T-8.15…T-8.18). Usable without React (`queryClient.fetchQuery` / `MutationObserver`). `[IK]`
 * routes take an optional `idempotencyKey` that the caller reuses for every retry of one intent;
 * approval retries reuse the approval's own key (API_CONTRACTS §6.3).
 */
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import type { ApiClient, ApiData, ApiInput } from '../api.ts';
import { isApiError } from '../errors.ts';
import { mk, qk } from '../query-keys.ts';

/** Variables of an `[IK]` call: the request parts plus the key reused for retries. */
export interface IdempotentRequest<I> {
  readonly input: I;
  readonly idempotencyKey?: string;
}

function ik(idempotencyKey: string | undefined): { idempotencyKey?: string } {
  return idempotencyKey === undefined ? {} : { idempotencyKey };
}

function transientOnly(failureCount: number, error: unknown, max: number): boolean {
  if (failureCount >= max || !isApiError(error)) return false;
  return error.kind === 'network' || error.kind === 'timeout' || error.retryable;
}

// ── Search (API-SRCH-01) ─────────────────────────────────────────────────────

export type SearchInput = NonNullable<ApiInput<'GET /search'>['query']>;

function searchParams(input: SearchInput): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
    else if (Array.isArray(value)) out[key] = value.join(',');
  }
  return out;
}

/**
 * `GET /search` (`mode=results` or `mode=answer`). Never persisted (Part 3 §0.8); TanStack aborts
 * the previous request through the query `signal` when the key changes.
 */
export function searchQueryOptions(client: ApiClient, input: SearchInput) {
  const params = searchParams(input);
  return queryOptions({
    queryKey: input.mode === 'answer' ? qk.search.memory(params) : qk.search.results(params),
    queryFn: async ({ signal }): Promise<ApiData<'GET /search'>> =>
      (await client.call('GET /search', { query: input }, { signal })).data,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: (failureCount, error) => transientOnly(failureCount, error, 1),
  });
}

// ── Assistant (API-AST-01) ───────────────────────────────────────────────────

/** API-AST-01 `POST /assistant/threads` (keyed by `client_thread_id`). */
export function assistantThreadMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.assistant.createThread,
    mutationFn: async (input: ApiInput<'POST /assistant/threads'>) =>
      (await client.call('POST /assistant/threads', input)).data,
    retry: (failureCount, error) => transientOnly(failureCount, error, 2),
  });
}

// ── Approvals (API-APR-01…05) ────────────────────────────────────────────────

/** API-APR-01 `POST /approvals` (new proposal; never for `email_send`). */
export function approvalProposeMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.approvals.propose,
    mutationFn: async ({ input, idempotencyKey }: IdempotentRequest<ApiInput<'POST /approvals'>>) =>
      (await client.call('POST /approvals', input, ik(idempotencyKey))).data,
  });
}

/** API-APR-02 `PATCH /approvals/:id` (a new payload version and key; the approval stays pending). */
export function approvalEditMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.approvals.edit,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'PATCH /approvals/:id'>>) =>
      (await client.call('PATCH /approvals/:id', input, ik(idempotencyKey))).data,
  });
}

/**
 * API-APR-03 `POST /approvals/:id/approve`. The HTTP `Idempotency-Key` is the approval's own
 * `idempotency_key` for the version the user saw, so a replay (double tap, retry of a failed
 * approval) returns the current state without a second job.
 */
export function approvalApproveMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.approvals.approve,
    mutationFn: async (input: ApiInput<'POST /approvals/:id/approve'>) =>
      (
        await client.call('POST /approvals/:id/approve', input, {
          idempotencyKey: input.body.idempotency_key,
        })
      ).data,
    retry: false,
  });
}

/** API-APR-04 `POST /approvals/:id/reject` (`user_reject` learns; `user_cancel` does not). */
export function approvalRejectMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.approvals.reject,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /approvals/:id/reject'>>) =>
      (await client.call('POST /approvals/:id/reject', input, ik(idempotencyKey))).data,
  });
}

/** API-APR-05 `POST /approvals/:id/device-execution` (`claim` or `result`, R-18). */
export function deviceExecutionMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.approvals.deviceExecution,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /approvals/:id/device-execution'>>) =>
      (await client.call('POST /approvals/:id/device-execution', input, ik(idempotencyKey))).data,
    retry: (failureCount, error) => transientOnly(failureCount, error, 2),
  });
}

// ── Reminders (API-REM-01…03) ────────────────────────────────────────────────

/** API-REM-01 `POST /reminders/resolve-time` (server resolution incl. "Uygun zamanda"). */
export function reminderResolveTimeMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.reminders.resolveTime,
    mutationFn: async (input: ApiInput<'POST /reminders/resolve-time'>) =>
      (await client.call('POST /reminders/resolve-time', input, { timeoutMs: 8_000 })).data,
    retry: false,
  });
}

/** API-REM-02 `POST /reminders` (`client_reminder_id` is the idempotency key). */
export function reminderCreateMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.reminders.create,
    mutationFn: async (input: ApiInput<'POST /reminders'>) =>
      (await client.call('POST /reminders', input)).data,
    retry: (failureCount, error) => transientOnly(failureCount, error, 3),
  });
}

/** API-REM-03 `POST /reminders/:id/cancel` (undo / replace). */
export function reminderCancelMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.reminders.cancel,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /reminders/:id/cancel'>>) =>
      (await client.call('POST /reminders/:id/cancel', input, ik(idempotencyKey))).data,
    retry: (failureCount, error) => transientOnly(failureCount, error, 3),
  });
}

// ── Captures (API-CAP-01…05) ─────────────────────────────────────────────────

/** API-CAP-01 `POST /captures/upload-url` (a signed Storage upload for one file). */
export function captureUploadUrlMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.captures.uploadUrl,
    mutationFn: async (input: ApiInput<'POST /captures/upload-url'>) =>
      (await client.call('POST /captures/upload-url', input)).data,
  });
}

/** API-CAP-02 `POST /captures` (text, link, share bundle or a mail attachment). */
export function captureCreateMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.captures.create,
    mutationFn: async (input: ApiInput<'POST /captures'>) =>
      (await client.call('POST /captures', input)).data,
  });
}

/** API-CAP-03 `POST /captures/:id/analyze` (202; also re-maps with `hint_type`). */
export function captureAnalyzeMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.captures.analyze,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /captures/:id/analyze'>>) =>
      (await client.call('POST /captures/:id/analyze', input, ik(idempotencyKey))).data,
  });
}

/** API-CAP-04 `POST /captures/:id/actions` (one pending approval per selected item). */
export function captureActionsMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.captures.actions,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /captures/:id/actions'>>) =>
      (await client.call('POST /captures/:id/actions', input, ik(idempotencyKey))).data,
  });
}

/** API-CAP-05 `POST /captures/:id/discard`. */
export function captureDiscardMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.captures.discard,
    mutationFn: async ({
      input,
      idempotencyKey,
    }: IdempotentRequest<ApiInput<'POST /captures/:id/discard'>>) =>
      (await client.call('POST /captures/:id/discard', input, ik(idempotencyKey))).data,
    retry: (failureCount, error) => transientOnly(failureCount, error, 2),
  });
}
