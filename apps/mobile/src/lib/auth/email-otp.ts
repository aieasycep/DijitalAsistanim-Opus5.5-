/**
 * E-mail one-time code (INTEGRATION_PLAN §8.4, M-ON-05E/05V; SREQ-48): no passwords. Supabase
 * sends a 6-digit code (`otp_length=6`, `otp_expiry=600`, resend `max_frequency=60s`) through the
 * custom SMTP (external credential). Sign-in mode does not create users
 * (`shouldCreateUser:false`), so an unknown address is reported instead of silently creating a
 * second account. The address stays in the screen's state; nothing here persists it.
 */
import { Email } from '@da/validation/api/common';
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { failed, succeeded, type AuthResult } from './result';
import { getSupabase, type AppSupabaseClient } from './supabase';

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 600_000;
export const OTP_RESEND_COOLDOWN_S = 60;

export type AuthMode = 'signup' | 'signin';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return Email.safeParse(normalizeEmail(value)).success;
}

export type OtpRequestFailure = 'no_account' | 'rate_limited' | 'network' | 'provider';

function isRateLimited(error: unknown): boolean {
  return isAuthApiError(error) && (error.status === 429 || (error.code ?? '').startsWith('over_'));
}

export function otpRequestFailureOf(error: unknown): OtpRequestFailure {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isRateLimited(error)) return 'rate_limited';
  if (
    isAuthApiError(error) &&
    (error.code === 'otp_disabled' || /signups? not allowed/i.test(error.message))
  ) {
    return 'no_account';
  }
  return 'provider';
}

export async function requestEmailOtp(
  input: { readonly email: string; readonly mode: AuthMode; readonly locale: 'tr' | 'en' },
  supabase: AppSupabaseClient = getSupabase(),
): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: OtpRequestFailure }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizeEmail(input.email),
      options: { shouldCreateUser: input.mode === 'signup', data: { locale: input.locale } },
    });
    return error === null ? { ok: true } : { ok: false, code: otpRequestFailureOf(error) };
  } catch (error) {
    return { ok: false, code: otpRequestFailureOf(error) };
  }
}

export type OtpVerifyFailure = 'invalid' | 'expired' | 'rate_limited' | 'network' | 'provider';

/**
 * GoTrue answers `otp_expired` ("Token has expired or is invalid") for both a wrong and an expired
 * code; the time since the code was sent tells them apart.
 */
export function otpVerifyFailureOf(
  error: unknown,
  sentAt: number,
  now: number = Date.now(),
): OtpVerifyFailure {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isRateLimited(error)) return 'rate_limited';
  if (isAuthApiError(error) && (error.code === 'otp_expired' || error.status === 403)) {
    return now - sentAt >= OTP_EXPIRY_MS ? 'expired' : 'invalid';
  }
  return 'provider';
}

export async function verifyEmailOtp(
  input: { readonly email: string; readonly token: string; readonly sentAt: number },
  supabase: AppSupabaseClient = getSupabase(),
): Promise<AuthResult | { readonly ok: false; readonly code: OtpVerifyFailure }> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizeEmail(input.email),
      token: input.token,
      type: 'email',
    });
    if (error !== null) return { ok: false, code: otpVerifyFailureOf(error, input.sentAt) };
    return data.user === null ? failed('provider') : succeeded(data.user);
  } catch (error) {
    return { ok: false, code: otpVerifyFailureOf(error, input.sentAt) };
  }
}
