/**
 * PostgREST access for the feature screens (API_CONTRACTS §15): RPC-01…RPC-23 and explicit-column
 * table reads run through the user's Supabase client, so RLS scopes every row to the caller.
 * Failures become typed `ApiError`s, like the Edge `api` client's, so screens handle both the same
 * way: RPC exceptions raise `CODE[:detail]` (e.g. `ENTITLEMENT_REQUIRED:commitments`,
 * `NOT_FOUND`), PostgREST's "no row" (`PGRST116`) is `NOT_FOUND`, and transport failures are
 * `network` errors.
 */
import { ApiError, type Database } from '@da/api-client';
import { ERROR_CODE_VALUES, type ErrorCodeValue } from '@da/validation/errors';

import { getSupabase } from '../auth/supabase';

type Functions = Database['public']['Functions'];
export type RpcName = keyof Functions;

interface PostgrestLikeError {
  readonly message: string;
  readonly code?: string;
  readonly details?: string | null;
}

const KNOWN = new Set<string>(ERROR_CODE_VALUES);

function isErrorCode(value: string): value is ErrorCodeValue {
  return KNOWN.has(value);
}

/** Maps a PostgREST / RPC error to the shared `ApiError` shape. */
export function toDataError(error: PostgrestLikeError | Error): ApiError {
  const message = error.message;
  const pgCode = 'code' in error ? error.code : undefined;
  if (pgCode === 'PGRST116') {
    return new ApiError({ code: 'NOT_FOUND', kind: 'server', status: 404, message });
  }
  const [head = '', detail] = message.split(':', 2);
  if (isErrorCode(head)) {
    return new ApiError({
      code: head,
      kind: 'server',
      status: null,
      message,
      ...(detail === undefined ? {} : { details: { reason: detail } }),
    });
  }
  if (/network|fetch|timed? ?out|abort/i.test(message)) {
    return new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null, message });
  }
  return new ApiError({ code: 'INTERNAL_ERROR', kind: 'server', status: null, message });
}

type DataOf<R> = R extends { readonly data: infer D } ? D : never;
interface Result {
  readonly data: unknown;
  readonly error: PostgrestLikeError | null;
}

/** Throws the mapped error when a PostgREST call failed; returns its data otherwise. */
export function unwrap<R extends Result>(result: R): NonNullable<DataOf<R>> {
  if (result.error !== null) throw toDataError(result.error);
  if (result.data === null || result.data === undefined) {
    throw new ApiError({ code: 'NOT_FOUND', kind: 'server', status: 404, message: 'no rows' });
  }
  return result.data as NonNullable<DataOf<R>>;
}

/** Like `unwrap`, but a missing row is `null` (`maybeSingle`). */
export function unwrapMaybe<R extends Result>(result: R): NonNullable<DataOf<R>> | null {
  if (result.error !== null) throw toDataError(result.error);
  return (result.data ?? null) as NonNullable<DataOf<R>> | null;
}

/** Calls one RPC as the signed-in user and returns its JSON result. */
export async function callRpc<N extends RpcName>(
  name: N,
  args: Functions[N]['Args'],
): Promise<Functions[N]['Returns']> {
  let result: { data: unknown; error: PostgrestLikeError | null };
  try {
    result = await getSupabase().rpc(name, args);
  } catch (error) {
    throw toDataError(error instanceof Error ? error : new Error(String(error)));
  }
  if (result.error !== null) throw toDataError(result.error);
  return result.data as Functions[N]['Returns'];
}

/** The i18n-safe error code of anything thrown by a data call. */
export function errorCodeOf(error: unknown): ErrorCodeValue | null {
  return error instanceof ApiError ? error.code : null;
}

/** Offline failures (blocked before the call, or no transport). */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'offline' || error.kind === 'network');
}
