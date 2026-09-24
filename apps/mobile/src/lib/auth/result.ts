/**
 * Shared sign-in result types. Failure codes are exactly the `auth_failed.code` analytics values
 * (SCREEN_AND_FLOW_MAP M-ON-05): cancellations are silent, the others show the inline error card.
 */
import { isAuthApiError, isAuthRetryableFetchError, type User } from '@supabase/supabase-js';

export type AuthMethod = 'apple' | 'google' | 'microsoft' | 'email_otp';

export type AuthFailureCode =
  'cancelled' | 'network' | 'provider' | 'not_configured' | 'play_services';

export type AuthResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly isNewUser: boolean;
      /** Another path (the callback route) already ran the post-sign-in pipeline for this code. */
      readonly completedElsewhere?: boolean;
    }
  | { readonly ok: false; readonly code: AuthFailureCode };

/** A user created within the last minute is treated as new (M-ON-05N heuristic). */
export const NEW_USER_WINDOW_MS = 60_000;

export function succeeded(
  user: Pick<User, 'id' | 'created_at'>,
  now: number = Date.now(),
): AuthResult {
  const created = Date.parse(user.created_at);
  return {
    ok: true,
    userId: user.id,
    isNewUser: Number.isFinite(created) && now - created < NEW_USER_WINDOW_MS,
  };
}

export function failed(code: AuthFailureCode): AuthResult {
  return { ok: false, code };
}

/** Maps a Supabase Auth error to a failure code. */
export function authFailureOf(error: unknown): AuthFailureCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error)) {
    const code = error.code ?? '';
    if (code === 'provider_disabled' || code === 'validation_failed' || error.status === 400) {
      return /provider.*(not enabled|disabled)|unsupported provider/i.test(error.message)
        ? 'not_configured'
        : 'provider';
    }
    return 'provider';
  }
  if (error instanceof TypeError) return 'network';
  return 'provider';
}

/** `code` of a native module error (`ERR_REQUEST_CANCELED`, `SIGN_IN_CANCELLED`, …). */
export function nativeErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
