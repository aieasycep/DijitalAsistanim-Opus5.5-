/**
 * Provider error taxonomy and its effect on `connected_accounts.status` (INTEGRATION_PLAN §2.9,
 * §3.6 retry policy, §3.8 status machine and precedence, §3.9 error → status → UI copy).
 *
 * Adapters classify every provider failure into a `ProviderErrorCode` and throw `ProviderError`.
 * The worker then looks up `PROVIDER_ERROR_POLICY` for the account status change and the retry
 * behaviour. UI copy for each status lives in `packages/i18n` under `integrations.status.*`.
 */
import type { AccountStatus } from '../enums.ts';
import { PROVIDER_ERROR_CODES, type ProviderErrorCode } from './types.ts';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;
  /** Provider-side reason code (e.g. `invalid_grant`, `AADSTS53003`); never content. */
  readonly providerReason: string | null;

  constructor(
    code: ProviderErrorCode,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null,
    providerReason: string | null = null,
  ) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
    this.providerReason = providerReason;
  }
}

export function isProviderErrorCode(value: string): value is ProviderErrorCode {
  return (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/**
 * - `retry_after`: reschedule at `max(Retry-After, base)`.
 * - `backoff`: exponential backoff with jitter.
 * - `resync`: immediate bounded resync (Gmail last 7 days, Calendar full horizon, Graph new delta).
 * - `reconcile_delete`: handled inline as a delete of the local copy.
 * - `treat_as_success`: the write already happened (deterministic id); fetch it and succeed.
 * - `no_retry`: stop; the status change (if any) tells the user what to do.
 * - `dead_letter`: our request was wrong; dead-letter the job and report to Sentry.
 */
export type ProviderRetryAction =
  | 'retry_after'
  | 'backoff'
  | 'resync'
  | 'reconcile_delete'
  | 'treat_as_success'
  | 'no_retry'
  | 'dead_letter';

export interface ProviderErrorPolicy {
  /** The status the account moves to, or null when this error leaves the status unchanged. */
  accountStatus: AccountStatus | null;
  retry: ProviderRetryAction;
  /** System Health turns red and ops is alerted (our side is misconfigured). */
  opsAlert: boolean;
}

export const PROVIDER_ERROR_POLICY: Readonly<Record<ProviderErrorCode, ProviderErrorPolicy>> = {
  auth_invalid_grant: { accountStatus: 'needs_reauth', retry: 'no_retry', opsAlert: false },
  auth_token_rejected: { accountStatus: 'needs_reauth', retry: 'no_retry', opsAlert: false },
  consent_admin_required: {
    accountStatus: 'admin_consent_required',
    retry: 'no_retry',
    opsAlert: false,
  },
  // The connect flow ends with "Erişim izni reddedildi."; no account row is created or changed.
  consent_denied: { accountStatus: null, retry: 'no_retry', opsAlert: false },
  // The capability is disabled; everything else keeps working.
  scope_missing: { accountStatus: 'partial', retry: 'no_retry', opsAlert: false },
  // Reconnect/upgrade returned another identity: the flow is refused, the account is unchanged.
  account_mismatch: { accountStatus: null, retry: 'no_retry', opsAlert: false },
  mailbox_unavailable: { accountStatus: 'partial', retry: 'no_retry', opsAlert: false },
  conditional_access_blocked: { accountStatus: 'error', retry: 'no_retry', opsAlert: false },
  rate_limited: { accountStatus: null, retry: 'retry_after', opsAlert: false },
  quota_exhausted_daily: { accountStatus: null, retry: 'retry_after', opsAlert: false },
  cursor_invalid: { accountStatus: null, retry: 'resync', opsAlert: false },
  not_found: { accountStatus: null, retry: 'reconcile_delete', opsAlert: false },
  conflict_exists: { accountStatus: null, retry: 'treat_as_success', opsAlert: false },
  // An etag mismatch makes the approved change stale (APPROVAL_STALE); no automatic retry.
  precondition_failed: { accountStatus: null, retry: 'no_retry', opsAlert: false },
  not_organizer: { accountStatus: null, retry: 'no_retry', opsAlert: false },
  // Persistent failures escalate through `shouldEscalateToError`, not per error.
  provider_unavailable: { accountStatus: null, retry: 'backoff', opsAlert: false },
  client_credential_invalid: { accountStatus: 'error', retry: 'no_retry', opsAlert: true },
  external_credential_required: { accountStatus: 'error', retry: 'no_retry', opsAlert: true },
  payload_invalid: { accountStatus: null, retry: 'dead_letter', opsAlert: true },
  unknown: { accountStatus: null, retry: 'backoff', opsAlert: false },
};

export function accountStatusForProviderError(code: ProviderErrorCode): AccountStatus | null {
  return PROVIDER_ERROR_POLICY[code].accountStatus;
}

/** Highest first (§3.8): the status shown when several conditions hold at once. */
export const ACCOUNT_STATUS_PRECEDENCE: readonly AccountStatus[] = [
  'disconnected',
  'needs_reauth',
  'admin_consent_required',
  'error',
  'partial',
  'syncing',
  'connecting',
  'healthy',
];

/** Picks the status with the highest precedence; no condition means `healthy`. */
export function resolveAccountStatus(conditions: readonly AccountStatus[]): AccountStatus {
  for (const status of ACCOUNT_STATUS_PRECEDENCE) {
    if (conditions.includes(status)) return status;
  }
  return 'healthy';
}

export const PROVIDER_RETRY = {
  baseMs: 30_000,
  capMs: 30 * 60_000,
  /** ±20 % jitter. */
  jitterRatio: 0.2,
  /** `rate_limited` raises the job's `max_attempts` to 12. */
  rateLimitedMaxAttempts: 12,
  /** Account escalation to `error` (§3.6). */
  escalationFailedRuns: 5,
  pushSuccessWindowMs: 6 * 60 * 60_000,
  pollGraceMs: 60 * 60_000,
} as const;

/**
 * Delay before the next attempt, or null when the error is not retried by rescheduling.
 * `jitter` ∈ [−1, 1] is supplied by the caller (random in production, fixed in tests).
 */
export function providerRetryDelayMs(
  code: ProviderErrorCode,
  input: { attempt: number; retryAfterMs: number | null; jitter: number },
): number | null {
  const action = PROVIDER_ERROR_POLICY[code].retry;
  if (action === 'resync') return 0;
  if (action === 'retry_after') {
    return Math.max(input.retryAfterMs ?? 0, PROVIDER_RETRY.baseMs);
  }
  if (action !== 'backoff') return null;
  const attempt = Math.max(1, Math.floor(input.attempt));
  const exponential = Math.min(PROVIDER_RETRY.baseMs * 2 ** (attempt - 1), PROVIDER_RETRY.capMs);
  const jitter = Math.max(-1, Math.min(1, input.jitter)) * PROVIDER_RETRY.jitterRatio;
  return Math.min(Math.round(exponential * (1 + jitter)), PROVIDER_RETRY.capMs);
}

export function maxAttemptsFor(code: ProviderErrorCode, defaultMaxAttempts: number): number {
  return code === 'rate_limited'
    ? Math.max(defaultMaxAttempts, PROVIDER_RETRY.rateLimitedMaxAttempts)
    : defaultMaxAttempts;
}

export type SyncResourceKind = { kind: 'push' } | { kind: 'polled'; pollIntervalMs: number };

/**
 * Account escalation (§3.6): 5 consecutive failed runs, or no success for 6 h on a push-enabled
 * resource, or for 1 h past the poll interval on a polled resource → status `error`.
 */
export function shouldEscalateToError(input: {
  consecutiveFailedRuns: number;
  lastSuccessAt: string | null;
  now: Date;
  resource: SyncResourceKind;
}): boolean {
  if (input.consecutiveFailedRuns >= PROVIDER_RETRY.escalationFailedRuns) return true;
  if (input.lastSuccessAt === null) return false;
  const since = input.now.getTime() - Date.parse(input.lastSuccessAt);
  const window =
    input.resource.kind === 'push'
      ? PROVIDER_RETRY.pushSuccessWindowMs
      : input.resource.pollIntervalMs + PROVIDER_RETRY.pollGraceMs;
  return since > window;
}
