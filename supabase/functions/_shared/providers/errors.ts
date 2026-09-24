/**
 * Provider error normalisation (API_CONTRACTS §2.7, INTEGRATION_PLAN §2.9/§3.9, IMPLEMENTATION_PLAN
 * T-3.08). Adapters throw the domain `ProviderError`; this module classifies raw HTTP failures,
 * maps them to API error codes for synchronous routes and to the `connected_accounts.status`
 * change the worker persists.
 */
import {
  accountStatusForProviderError,
  type AccountStatus,
  PROVIDER_ERROR_POLICY,
  ProviderError,
  type ProviderErrorCode,
} from '@da/domain';
import type { ErrorCodeValue } from '@da/validation';
import { AppError } from '../errors.ts';

export type ProviderName = 'google' | 'microsoft' | 'apple' | 'revenuecat' | 'expo' | 'demo';

/** API error code for each provider error class (§2.7). */
export const PROVIDER_TO_API_CODE: Readonly<Record<ProviderErrorCode, ErrorCodeValue>> = {
  auth_invalid_grant: 'PROVIDER_REAUTH_REQUIRED',
  auth_token_rejected: 'PROVIDER_REAUTH_REQUIRED',
  consent_admin_required: 'PROVIDER_ADMIN_CONSENT_REQUIRED',
  consent_denied: 'PROVIDER_REJECTED',
  scope_missing: 'PROVIDER_SCOPE_MISSING',
  account_mismatch: 'PROVIDER_REJECTED',
  mailbox_unavailable: 'PROVIDER_REJECTED',
  conditional_access_blocked: 'PROVIDER_REJECTED',
  rate_limited: 'PROVIDER_RATE_LIMITED',
  quota_exhausted_daily: 'PROVIDER_RATE_LIMITED',
  cursor_invalid: 'PROVIDER_UNAVAILABLE',
  not_found: 'SOURCE_GONE',
  conflict_exists: 'STATE_CONFLICT',
  precondition_failed: 'APPROVAL_STALE',
  not_organizer: 'PROVIDER_REJECTED',
  provider_unavailable: 'PROVIDER_UNAVAILABLE',
  client_credential_invalid: 'EXTERNAL_CREDENTIAL_REQUIRED',
  external_credential_required: 'EXTERNAL_CREDENTIAL_REQUIRED',
  payload_invalid: 'PROVIDER_REJECTED',
  unknown: 'PROVIDER_UNAVAILABLE',
};

/** Parses `Retry-After` (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export interface ProviderErrorBody {
  /** OAuth `error` / Google `error.status` / Graph `error.code`. */
  readonly code?: string | null;
  /** Google `error.errors[0].reason`, AADSTS code, … */
  readonly reason?: string | null;
}

const REAUTH_REASONS = /invalid_grant|AADSTS700082|AADSTS50173|AADSTS70008|AADSTS50078/i;
const ADMIN_CONSENT = /AADSTS90094|AADSTS90008|admin[_ ]?consent/i;
const SCOPE_MISSING =
  /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient_scope|AADSTS65001|ErrorAccessDenied/i;
const RATE_LIMIT = /rateLimitExceeded|userRateLimitExceeded|TooManyRequests|ApplicationThrottled/i;
const DAILY_QUOTA = /dailyLimitExceeded|quotaExceeded/i;
const CONDITIONAL_ACCESS = /AADSTS53003|AADSTS530/i;

/** Classifies a non-2xx provider response (content-free: codes and reasons only). */
export function classifyProviderFailure(
  status: number,
  body: ProviderErrorBody = {},
  retryAfterMs: number | null = null,
): ProviderError {
  const signal = `${body.code ?? ''} ${body.reason ?? ''}`;
  const reason = (body.reason ?? body.code ?? null)?.slice(0, 80) ?? null;
  const make = (code: ProviderErrorCode) => new ProviderError(code, status, retryAfterMs, reason);
  if (REAUTH_REASONS.test(signal)) return make('auth_invalid_grant');
  if (ADMIN_CONSENT.test(signal)) return make('consent_admin_required');
  if (CONDITIONAL_ACCESS.test(signal)) return make('conditional_access_blocked');
  if (status === 429 || RATE_LIMIT.test(signal)) return make('rate_limited');
  if (DAILY_QUOTA.test(signal)) return make('quota_exhausted_daily');
  if (SCOPE_MISSING.test(signal)) return make('scope_missing');
  if (/invalid_client|unauthorized_client|AADSTS7000215|AADSTS700027/i.test(signal)) {
    return make('client_credential_invalid');
  }
  if (status === 401) return make('auth_token_rejected');
  if (status === 403) return make('scope_missing');
  if (status === 404 || /ErrorItemNotFound/i.test(signal)) return make('not_found');
  if (status === 409) return make('conflict_exists');
  if (status === 410 || /fullSyncRequired|syncStateNotFound/i.test(signal))
    return make('cursor_invalid');
  if (status === 412) return make('precondition_failed');
  if (status >= 500) return make('provider_unavailable');
  if (status >= 400) return make('payload_invalid');
  return make('unknown');
}

/** API error for a synchronous route. */
export function providerErrorToAppError(
  error: ProviderError,
  provider: ProviderName,
  accountId?: string,
): AppError {
  const code = PROVIDER_TO_API_CODE[error.code];
  const details: Record<string, unknown> = { provider };
  if (accountId !== undefined) details.account_id = accountId;
  if (code === 'PROVIDER_REJECTED' && error.providerReason !== null)
    details.provider_reason = error.providerReason;
  const headers: Record<string, string> = {};
  if (error.retryAfterMs !== null && code === 'PROVIDER_RATE_LIMITED') {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
  }
  return new AppError(code, { details, headers, cause: error });
}

/** The `connected_accounts` status change a provider error implies (null = unchanged). */
export function accountStatusChange(
  error: ProviderError,
): { status: AccountStatus; statusReason: string } | null {
  const status = accountStatusForProviderError(error.code);
  if (status === null) return null;
  const reasons: Partial<Record<ProviderErrorCode, string>> = {
    auth_invalid_grant: 'invalid_grant',
    auth_token_rejected: 'invalid_grant',
    consent_admin_required: 'admin_consent_required',
    scope_missing: 'scope_missing',
    mailbox_unavailable: 'permission_denied',
    conditional_access_blocked: 'permission_denied',
    client_credential_invalid: 'provider_error',
    external_credential_required: 'external_credential_required',
  };
  return { status, statusReason: reasons[error.code] ?? 'provider_error' };
}

export function isOpsAlert(error: ProviderError): boolean {
  return PROVIDER_ERROR_POLICY[error.code].opsAlert;
}
