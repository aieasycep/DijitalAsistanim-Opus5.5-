import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUS_VALUES, type AccountStatus } from '../../src/enums.ts';
import {
  ACCOUNT_STATUS_PRECEDENCE,
  PROVIDER_ERROR_POLICY,
  ProviderError,
  accountStatusForProviderError,
  isProviderError,
  isProviderErrorCode,
  maxAttemptsFor,
  providerRetryDelayMs,
  resolveAccountStatus,
  shouldEscalateToError,
} from '../../src/providers/errors.ts';
import { PROVIDER_ERROR_CODES, type ProviderErrorCode } from '../../src/providers/types.ts';
import { markdownSection, readRepoFile } from '../rbac/doc-sources.ts';

describe('ProviderError taxonomy (INTEGRATION_PLAN §2.9)', () => {
  it('lists exactly the documented codes', () => {
    const section = markdownSection(readRepoFile('docs/INTEGRATION_PLAN.md'), /^### 2\.9 /);
    const documented = [...section.matchAll(/\| '([a-z_]+)'/g)].map((m) => m[1]);
    expect(PROVIDER_ERROR_CODES).toEqual(documented);
  });

  it('carries code, HTTP status, Retry-After and provider reason', () => {
    const error = new ProviderError('rate_limited', 429, 12_000, 'userRateLimitExceeded');
    expect(error).toBeInstanceOf(Error);
    expect(isProviderError(error)).toBe(true);
    expect(isProviderError(new Error('x'))).toBe(false);
    expect(error).toMatchObject({
      name: 'ProviderError',
      message: 'rate_limited',
      code: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 12_000,
      providerReason: 'userRateLimitExceeded',
    });
    expect(new ProviderError('unknown')).toMatchObject({
      httpStatus: null,
      retryAfterMs: null,
      providerReason: null,
    });
    expect(isProviderErrorCode('cursor_invalid')).toBe(true);
    expect(isProviderErrorCode('boom')).toBe(false);
  });
});

describe('ProviderError → account_status (INTEGRATION_PLAN §3.6, §3.9)', () => {
  const expected: [ProviderErrorCode, AccountStatus | null][] = [
    ['auth_invalid_grant', 'needs_reauth'],
    ['auth_token_rejected', 'needs_reauth'],
    ['consent_admin_required', 'admin_consent_required'],
    ['consent_denied', null],
    ['scope_missing', 'partial'],
    ['account_mismatch', null],
    ['mailbox_unavailable', 'partial'],
    ['conditional_access_blocked', 'error'],
    ['rate_limited', null],
    ['quota_exhausted_daily', null],
    ['cursor_invalid', null],
    ['not_found', null],
    ['conflict_exists', null],
    ['precondition_failed', null],
    ['not_organizer', null],
    ['provider_unavailable', null],
    ['client_credential_invalid', 'error'],
    ['external_credential_required', 'error'],
    ['payload_invalid', null],
    ['unknown', null],
  ];

  it('covers every code', () => {
    expect(expected.map(([code]) => code).sort()).toEqual([...PROVIDER_ERROR_CODES].sort());
  });

  it.each(expected)('%s → %s', (code, status) => {
    expect(accountStatusForProviderError(code)).toBe(status);
  });

  it.each([
    ['rate_limited', 'retry_after'],
    ['provider_unavailable', 'backoff'],
    ['cursor_invalid', 'resync'],
    ['not_found', 'reconcile_delete'],
    ['conflict_exists', 'treat_as_success'],
    ['payload_invalid', 'dead_letter'],
    ['auth_invalid_grant', 'no_retry'],
    ['scope_missing', 'no_retry'],
  ] as const)('%s retry action is %s', (code, action) => {
    expect(PROVIDER_ERROR_POLICY[code].retry).toBe(action);
  });

  it('alerts ops only for our own misconfiguration', () => {
    const alerting = PROVIDER_ERROR_CODES.filter((code) => PROVIDER_ERROR_POLICY[code].opsAlert);
    expect(alerting).toEqual([
      'client_credential_invalid',
      'external_credential_required',
      'payload_invalid',
    ]);
  });
});

describe('status precedence (INTEGRATION_PLAN §3.8)', () => {
  it('orders every account_status exactly once', () => {
    expect([...ACCOUNT_STATUS_PRECEDENCE].sort()).toEqual([...ACCOUNT_STATUS_VALUES].sort());
  });

  it.each([
    [[], 'healthy'],
    [['healthy', 'syncing'], 'syncing'],
    [['partial', 'error'], 'error'],
    [['error', 'needs_reauth', 'admin_consent_required'], 'needs_reauth'],
    [['needs_reauth', 'disconnected'], 'disconnected'],
    [['connecting', 'healthy'], 'connecting'],
    [['partial', 'syncing'], 'partial'],
  ] as const)('%j → %s', (conditions, status) => {
    expect(resolveAccountStatus(conditions)).toBe(status);
  });
});

describe('retry delays and escalation (INTEGRATION_PLAN §3.6)', () => {
  it.each([
    ['provider_unavailable', 1, null, 0, 30_000],
    ['provider_unavailable', 2, null, 0, 60_000],
    ['provider_unavailable', 3, null, 1, 144_000],
    ['provider_unavailable', 3, null, -1, 96_000],
    ['provider_unavailable', 20, null, 1, 1_800_000],
    ['unknown', 1, null, 0, 30_000],
    ['rate_limited', 1, 120_000, 0, 120_000],
    ['rate_limited', 1, 5_000, 0, 30_000],
    ['rate_limited', 1, null, 0, 30_000],
    ['cursor_invalid', 4, null, 0, 0],
    ['auth_invalid_grant', 1, null, 0, null],
    ['conflict_exists', 1, null, 0, null],
  ] as const)(
    '%s attempt %i (Retry-After %s, jitter %s) → %s ms',
    (code, attempt, retryAfterMs, jitter, delay) => {
      expect(providerRetryDelayMs(code, { attempt, retryAfterMs, jitter })).toBe(delay);
    },
  );

  it('raises max attempts to 12 for rate limiting only', () => {
    expect(maxAttemptsFor('rate_limited', 5)).toBe(12);
    expect(maxAttemptsFor('provider_unavailable', 5)).toBe(5);
  });

  const now = new Date('2026-09-23T06:00:00Z');
  it.each([
    [5, '2026-09-23T05:59:00Z', { kind: 'push' }, true],
    [4, '2026-09-23T05:59:00Z', { kind: 'push' }, false],
    [0, '2026-09-22T23:59:00Z', { kind: 'push' }, true],
    [0, '2026-09-23T00:00:00Z', { kind: 'push' }, false],
    [0, '2026-09-23T04:44:00Z', { kind: 'polled', pollIntervalMs: 15 * 60_000 }, true],
    [0, '2026-09-23T04:46:00Z', { kind: 'polled', pollIntervalMs: 15 * 60_000 }, false],
    [2, null, { kind: 'push' }, false],
  ] as const)(
    '%i failed runs, last success %s, %j → escalate %s',
    (runs, last, resource, escalate) => {
      expect(
        shouldEscalateToError({ consecutiveFailedRuns: runs, lastSuccessAt: last, now, resource }),
      ).toBe(escalate);
    },
  );
});
