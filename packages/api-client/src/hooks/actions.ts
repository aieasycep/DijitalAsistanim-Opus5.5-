/**
 * Query and mutation option factories for the Flow, Mail, Reply, Approval, Plan and Meeting
 * surfaces (T-8.10…T-8.14). They are React-free TanStack option objects over the typed `api`
 * client, so screens use them with `useQuery` / `useMutation` and tests drive them with a
 * `QueryClient` or `MutationObserver`.
 *
 * - `[IK]` mutations take `{ input, idempotencyKey? }`: pass the same key for every retry of one
 *   user intent (the client generates one otherwise).
 * - The original mail body (`GET /mail/:messageId/original`) is a memory-only query: no
 *   `meta.persist`, a 5 minute `gcTime`, never written to the persisted cache.
 */
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import type {
  ApiClient,
  ApiData,
  ApiInput,
  ApiResponse,
  CallOptions,
  JsonRouteKey,
} from '../api.ts';
import { isApiError } from '../errors.ts';
import { qk } from '../query-keys.ts';

/** Variables of a route mutation: the request parts and an optional idempotency key. */
export interface RouteVariables<K extends JsonRouteKey> {
  readonly input: ApiInput<K>;
  readonly idempotencyKey?: string;
}

type Caller<K extends JsonRouteKey> = (
  key: K,
  input: ApiInput<K>,
  options: CallOptions,
) => Promise<ApiResponse<K>>;

/** Calls one route with its input, returning the envelope's `data`. */
export async function callRoute<K extends JsonRouteKey>(
  client: ApiClient,
  key: K,
  input: ApiInput<K>,
  options: CallOptions = {},
): Promise<ApiData<K>> {
  const call = client.call.bind(client) as unknown as Caller<K>;
  const response = (await call(key, input, options)) as { readonly data: ApiData<K> };
  return response.data;
}

/** Transient failures only (network, timeout, retryable server codes), at most `max` times. */
export function retryTransient(max: number) {
  return (failureCount: number, error: unknown): boolean => {
    if (failureCount >= max || !isApiError(error)) return false;
    return error.kind === 'network' || error.kind === 'timeout' || error.retryable;
  };
}

/** A mutation over one `api` route. The mutation key is `['api', '<METHOD /path>']`. */
export function apiMutationOptions<K extends JsonRouteKey>(client: ApiClient, key: K) {
  return mutationOptions({
    mutationKey: ['api', key] as const,
    mutationFn: ({ input, idempotencyKey }: RouteVariables<K>) =>
      callRoute(client, key, input, idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

/** Every route the T-8.10…T-8.14 screens write through (documented for the offline audit). */
export const ACTION_MUTATION_ROUTES = [
  'POST /mail/:messageId/reply-drafts',
  'POST /reply-drafts/:id/regenerate',
  'PATCH /reply-drafts/:id',
  'POST /reply-drafts/:id/submit',
  'POST /followups/:threadId/draft',
  'POST /reply-drafts/:id/attachments/upload-url',
  'POST /approvals',
  'PATCH /approvals/:id',
  'POST /approvals/:id/approve',
  'POST /approvals/:id/reject',
  'POST /reminders',
  'POST /reminders/:id/cancel',
  'POST /plan/proposals',
  'POST /plan/conflicts/:insightId/resolve',
  'POST /meetings/:eventId/prep',
  'POST /meetings/:eventId/notes',
  'POST /meetings/:eventId/post',
  'POST /meetings/:eventId/prep/audio',
  'POST /integrations/:accountId/sync',
  'POST /integrations/:accountId/upgrade',
  'POST /integrations/oauth/complete',
] as const satisfies readonly JsonRouteKey[];

/** 5 min: the original body lives in memory only (M-MAIL-03, SECURITY CTL-3.13). */
export const MAIL_ORIGINAL_GC_TIME_MS = 5 * 60_000;

/** API-MAIL-01: the sanitised original, fetched on demand; never persisted. */
export function mailOriginalQueryOptions(client: ApiClient, messageId: string) {
  return queryOptions({
    queryKey: qk.mail.original(messageId),
    queryFn: ({ signal }) =>
      callRoute(
        client,
        'GET /mail/:messageId/original',
        { params: { messageId }, query: { remote_images: 'blocked' } },
        { signal },
      ),
    gcTime: MAIL_ORIGINAL_GC_TIME_MS,
    staleTime: 0,
    retry: retryTransient(2),
  });
}

/** API-MAIL-07: the thread summary (cached server-side; persisted as a derived field). */
export function threadSummaryQueryOptions(client: ApiClient, threadId: string) {
  return queryOptions({
    queryKey: qk.mail.threadSummary(threadId),
    queryFn: () =>
      callRoute(client, 'POST /mail/threads/:threadId/summary', {
        params: { threadId },
        body: { refresh: false },
      }),
    staleTime: 10 * 60_000,
    meta: { persist: true },
    retry: retryTransient(1),
  });
}

export interface FreeSlotsRange {
  readonly from: string;
  readonly to: string;
  readonly minMinutes: number;
}

/** API-PLAN-01: real free slots only (M-PLAN-04); not persisted. */
export function freeSlotsQueryOptions(client: ApiClient, range: FreeSlotsRange) {
  return queryOptions({
    queryKey: qk.plan.freeSlots(range.from, range.to, range.minMinutes),
    queryFn: ({ signal }) =>
      callRoute(
        client,
        'GET /plan/free-slots',
        {
          query: {
            from: range.from,
            to: range.to,
            min_minutes: range.minMinutes,
            within_working_hours: 'true',
          },
        },
        { signal },
      ),
    staleTime: 30_000,
    retry: retryTransient(2),
  });
}

/** API-PLAN-03: ranked conflict options, recomputed on open (not persisted). */
export function conflictOptionsQueryOptions(client: ApiClient, insightId: string) {
  return queryOptions({
    queryKey: qk.plan.conflict(insightId),
    queryFn: () =>
      callRoute(client, 'POST /plan/conflicts/:insightId/options', {
        params: { insightId },
        body: {},
      }),
    staleTime: 60_000,
    retry: retryTransient(2),
  });
}

/** API-MEET-01 as a query: 200 with a fresh prep, or `generating` with a job to poll. */
export function meetingPrepQueryOptions(client: ApiClient, eventId: string) {
  return queryOptions({
    queryKey: qk.meetings.prep(eventId),
    queryFn: () =>
      callRoute(client, 'POST /meetings/:eventId/prep', {
        params: { eventId },
        body: { refresh: false },
      }),
    staleTime: 60_000,
    meta: { persist: true },
    retry: retryTransient(1),
  });
}
