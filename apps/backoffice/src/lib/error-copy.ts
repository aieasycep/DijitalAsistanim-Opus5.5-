import type { Messages } from '@da/i18n/use-intl';

/*
 * admin-api failures → the BACKOFFICE_PLAN §2.5 copy (`backoffice.errors.*`) and the session
 * redirects of §2.3 / §3.7. Pure, so server actions, route handlers and client components agree.
 */

export type ErrorMessageKey = keyof Messages['backoffice']['errors'];
export type LoginReason =
  'idle' | 'expired' | 'revoked' | 'logged_out' | 'not_admin' | 'mfa_failed';

export interface FailureLike {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string;
  readonly retryAfter?: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ErrorCopy {
  readonly key: ErrorMessageKey;
  readonly values: Readonly<Record<string, string | number>>;
}

function detail(failure: FailureLike, name: string): string | undefined {
  const value = failure.details?.[name];
  return typeof value === 'string' ? value : undefined;
}

/** The copy for a failure that is shown in place (not a redirect). */
export function errorCopy(failure: FailureLike): ErrorCopy {
  const reason = detail(failure, 'reason') ?? detail(failure, 'reason_key') ?? '';
  switch (failure.code) {
    case 'FORBIDDEN':
      return reason.includes('step_up')
        ? { key: 'stepUpRequired', values: {} }
        : { key: 'forbidden', values: {} };
    case 'NOT_FOUND':
    case 'SOURCE_GONE':
      return { key: 'notFound', values: {} };
    case 'STATE_CONFLICT':
    case 'IDEMPOTENCY_REPLAY':
      if (reason.includes('last_super_admin')) return { key: 'lastSuperAdmin', values: {} };
      if (reason !== '' && !reason.includes('conflict')) return { key: 'invalidState', values: {} };
      return { key: 'conflict', values: {} };
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
    case 'REQUEST_INVALID':
      return reason.includes('reason')
        ? { key: 'reasonRequired', values: {} }
        : { key: 'validation', values: {} };
    case 'RATE_LIMITED':
      return { key: 'rateLimited', values: { seconds: failure.retryAfter ?? 60 } };
    case 'EXTERNAL_CREDENTIAL_REQUIRED':
      return { key: 'externalCredential', values: { service: detail(failure, 'service') ?? '—' } };
    case 'PROVIDER_UNAVAILABLE':
    case 'UPSTREAM_TIMEOUT':
    case 'SERVICE_UNAVAILABLE':
    case 'PROVIDER_RATE_LIMITED':
      return { key: 'upstream', values: { service: detail(failure, 'service') ?? '' } };
    case 'NETWORK_ERROR':
      return { key: 'network', values: {} };
    case 'CSRF_ORIGIN':
      return { key: 'csrf', values: {} };
    default:
      return { key: 'internal', values: { correlationId: failure.correlationId } };
  }
}

/**
 * Where a session failure sends the admin (`null` when the failure is not about the session):
 * `AUTH_REQUIRED` → `/login?reason=idle|expired|revoked`, `AAL2_REQUIRED` → `/mfa`.
 */
export function sessionRedirect(failure: FailureLike): string | null {
  if (failure.code === 'AAL2_REQUIRED') return '/mfa';
  if (failure.code !== 'AUTH_REQUIRED' && failure.code !== 'REAUTH_REQUIRED') return null;
  return `/login?reason=${loginReason(failure)}`;
}

export function loginReason(failure: FailureLike): LoginReason {
  const reason = (detail(failure, 'reason') ?? '').toLowerCase();
  if (reason.includes('revoked') || reason.includes('disabled')) return 'revoked';
  if (reason.includes('absolute')) return 'expired';
  if (reason.includes('not_admin') || reason.includes('forbidden')) return 'not_admin';
  return 'idle';
}

export const LOGIN_REASONS: readonly LoginReason[] = [
  'idle',
  'expired',
  'revoked',
  'logged_out',
  'not_admin',
  'mfa_failed',
];

export function isLoginReason(value: unknown): value is LoginReason {
  return typeof value === 'string' && (LOGIN_REASONS as readonly string[]).includes(value);
}
