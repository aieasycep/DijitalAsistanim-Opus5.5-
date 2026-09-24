/**
 * Approval policy: default expiry per action type (API_CONTRACTS §6.6) and the failure map
 * (`last_error_code` → retryable + i18n copy key) used by the Approval Center.
 */
import type { ApprovalActionType } from '../enums.ts';
import { type Instant, toDate } from '../time/zone.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ExpiryInput {
  readonly createdAt: Instant;
  /** Proposed start (`calendar_create`) or original start (`calendar_update`). */
  readonly eventStart?: Instant | null;
  /** `reminder_create` fire time. */
  readonly fireAt?: Instant | null;
}

/**
 * `approval_expires_at` per type: email_send created+72 h; calendar_create/update
 * min(start, created+7 d); task_create and commitment_create created+7 d; reminder_create fire_at.
 */
export function approvalExpiresAt(actionType: ApprovalActionType, input: ExpiryInput): Date {
  const created = toDate(input.createdAt).getTime();
  switch (actionType) {
    case 'email_send':
      return new Date(created + 72 * HOUR);
    case 'calendar_create':
    case 'calendar_update': {
      const cap = created + 7 * DAY;
      const start = input.eventStart ? toDate(input.eventStart).getTime() : cap;
      return new Date(Math.min(start, cap));
    }
    case 'task_create':
    case 'commitment_create':
      return new Date(created + 7 * DAY);
    case 'reminder_create': {
      if (!input.fireAt) throw new RangeError('reminder_create requires fireAt');
      return toDate(input.fireAt);
    }
  }
}

export function isApprovalExpired(expiresAt: Instant, now: Instant): boolean {
  return toDate(now).getTime() >= toDate(expiresAt).getTime();
}

export interface ApprovalFailurePolicy {
  /** A user retry (`failed → executing`) is offered. */
  readonly retryable: boolean;
  /** i18n key under `approvals.failure.*`. */
  readonly messageKey: string;
  /** Primary recovery action on the failed card. */
  readonly action: 'retry' | 'reconnect' | 'upgrade_scope' | 'repropose' | 'edit';
}

const FAILURES: Readonly<Record<string, ApprovalFailurePolicy>> = {
  APPROVAL_STALE: {
    retryable: false,
    messageKey: 'approvals.failure.stale',
    action: 'repropose',
  },
  PROVIDER_REAUTH_REQUIRED: {
    retryable: false,
    messageKey: 'approvals.failure.reauth',
    action: 'reconnect',
  },
  PROVIDER_SCOPE_MISSING: {
    retryable: false,
    messageKey: 'approvals.failure.scope',
    action: 'upgrade_scope',
  },
  PROVIDER_REJECTED: { retryable: false, messageKey: 'approvals.failure.rejected', action: 'edit' },
  PROVIDER_RATE_LIMITED: {
    retryable: true,
    messageKey: 'approvals.failure.rate_limited',
    action: 'retry',
  },
  PROVIDER_UNAVAILABLE: {
    retryable: true,
    messageKey: 'approvals.failure.unavailable',
    action: 'retry',
  },
  UPSTREAM_TIMEOUT: { retryable: true, messageKey: 'approvals.failure.timeout', action: 'retry' },
  DEVICE_RESULT_MISSING: {
    retryable: true,
    messageKey: 'approvals.failure.device_missing',
    action: 'retry',
  },
  DEVICE_WRITE_FAILED: {
    retryable: true,
    messageKey: 'approvals.failure.device_failed',
    action: 'retry',
  },
  DEVICE_CANCELLED: {
    retryable: true,
    messageKey: 'approvals.failure.device_cancelled',
    action: 'retry',
  },
};

const UNKNOWN_FAILURE: ApprovalFailurePolicy = {
  retryable: true,
  messageKey: 'approvals.failure.generic',
  action: 'retry',
};

export function approvalFailurePolicy(code: string | null | undefined): ApprovalFailurePolicy {
  return (code ? FAILURES[code] : undefined) ?? UNKNOWN_FAILURE;
}
