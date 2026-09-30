import { describe, expect, it } from 'vitest';

import { remainingMs } from '../admin-context';
import { errorCopy, loginReason, sessionRedirect } from '../error-copy';
import { deltaDirection, formatCountdown, formatNumber, formatPercent, formatUsd } from '../format';
import { UUID_PATTERN, uuidv7 } from '../ids';
import { maskEmail } from '../mask';

const failure = (code: string, details?: Record<string, unknown>, retryAfter?: number) => ({
  code,
  status: 400,
  correlationId: 'corr-1',
  ...(details === undefined ? {} : { details }),
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

describe('error copy (BACKOFFICE_PLAN §2.5)', () => {
  it('maps admin-api codes to the plan copy', () => {
    expect(errorCopy(failure('FORBIDDEN')).key).toBe('forbidden');
    expect(errorCopy(failure('FORBIDDEN', { reason: 'step_up_required' })).key).toBe(
      'stepUpRequired',
    );
    expect(errorCopy(failure('NOT_FOUND')).key).toBe('notFound');
    expect(errorCopy(failure('STATE_CONFLICT')).key).toBe('conflict');
    expect(errorCopy(failure('STATE_CONFLICT', { reason: 'last_super_admin' })).key).toBe(
      'lastSuperAdmin',
    );
    expect(errorCopy(failure('STATE_CONFLICT', { reason_key: 'job_running' })).key).toBe(
      'invalidState',
    );
    expect(errorCopy(failure('VALIDATION_FAILED', { reason: 'reason_required' })).key).toBe(
      'reasonRequired',
    );
    expect(errorCopy(failure('RATE_LIMITED', undefined, 30))).toEqual({
      key: 'rateLimited',
      values: { seconds: 30 },
    });
    expect(errorCopy(failure('EXTERNAL_CREDENTIAL_REQUIRED', { service: 'Postmark' }))).toEqual({
      key: 'externalCredential',
      values: { service: 'Postmark' },
    });
    expect(errorCopy(failure('NETWORK_ERROR')).key).toBe('network');
    expect(errorCopy(failure('INTERNAL_ERROR'))).toEqual({
      key: 'internal',
      values: { correlationId: 'corr-1' },
    });
  });

  it('turns session failures into /login reasons and /mfa', () => {
    expect(sessionRedirect(failure('AAL2_REQUIRED'))).toBe('/mfa');
    expect(sessionRedirect(failure('AUTH_REQUIRED', { reason: 'idle_timeout' }))).toBe(
      '/login?reason=idle',
    );
    expect(sessionRedirect(failure('AUTH_REQUIRED', { reason: 'absolute_timeout' }))).toBe(
      '/login?reason=expired',
    );
    expect(sessionRedirect(failure('AUTH_REQUIRED', { reason: 'session_revoked' }))).toBe(
      '/login?reason=revoked',
    );
    expect(sessionRedirect(failure('AUTH_REQUIRED', { reason: 'admin_session_expired' }))).toBe(
      '/login?reason=idle',
    );
    expect(sessionRedirect(failure('FORBIDDEN'))).toBeNull();
    expect(loginReason(failure('AUTH_REQUIRED', { reason: 'admin_disabled' }))).toBe('revoked');
  });
});

describe('formatting (§5.8)', () => {
  it('formats numbers, USD and percentages per locale', () => {
    expect(formatNumber('tr', 12480)).toBe('12.480');
    expect(formatNumber('en', 12480)).toBe('12,480');
    expect(formatUsd('en', 412.37)).toBe('$412.37');
    expect(formatUsd('en', 0.0955)).toBe('$0.0955');
    expect(formatPercent('en', 0.123)).toBe('12.3%');
    expect(formatCountdown(119.4)).toBe('01:59');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('classifies deltas', () => {
    expect(deltaDirection(0.04)).toBe('up');
    expect(deltaDirection(-0.04)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
    expect(deltaDirection(null)).toBe('none');
  });
});

describe('masking, ids and durations', () => {
  it('masks emails like private.mask_email', () => {
    expect(maskEmail('yusuf@gmail.com')).toBe('yu***@gmail.com');
    expect(maskEmail('ab@x.io')).toBe('a***@x.io');
    expect(maskEmail('abc123@privaterelay.appleid.com')).toBe('***@privaterelay.appleid.com');
  });

  it('creates time-ordered uuid v7 values', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(UUID_PATTERN);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });

  it('turns deadlines into durations against the server clock', () => {
    expect(remainingMs('2026-09-24T09:30:00Z', '2026-09-24T09:28:00Z')).toBe(120_000);
  });
});
