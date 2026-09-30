/**
 * Shared steps of the provider executors: opening the destination account, mapping provider
 * failures to approval failure codes (API_CONTRACTS §2.7, JOB-17 terminal list) and the follow-up
 * sync jobs that refresh the timeline from provider truth (F-10).
 */
import {
  type Capability,
  isProviderError,
  PROVIDER_ERROR_POLICY,
  type ProviderAccountRef,
  type WriteOutcome,
} from '@da/domain';
import { isAppError } from '../../../errors.ts';
import type { EnqueueInput, Json } from '../../../jobs/types.ts';
import { PROVIDER_TO_API_CODE } from '../../../providers/errors.ts';
import { type ExecEnv, ExecutionFailure, type ProviderSession } from './model.ts';

/** Non-retryable approval failures (JOB-17 "Terminal failed"). */
export const TERMINAL_CODES = new Set([
  'PROVIDER_REAUTH_REQUIRED',
  'PROVIDER_SCOPE_MISSING',
  'PROVIDER_ADMIN_CONSENT_REQUIRED',
  'PROVIDER_REJECTED',
  'APPROVAL_STALE',
  'ENTITLEMENT_REQUIRED',
  'SOURCE_GONE',
]);

/** Normalises anything a provider call throws into an `ExecutionFailure`. */
export function toFailure(error: unknown): ExecutionFailure {
  if (error instanceof ExecutionFailure) return error;
  if (isProviderError(error)) {
    const code = PROVIDER_TO_API_CODE[error.code];
    const policy = PROVIDER_ERROR_POLICY[error.code];
    const retryable =
      !TERMINAL_CODES.has(code) &&
      (policy.retry === 'backoff' || policy.retry === 'retry_after' || policy.retry === 'resync');
    const retryAfter =
      error.retryAfterMs === null ? null : Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return new ExecutionFailure(code, retryable, retryAfter, error.providerReason ?? error.code);
  }
  if (isAppError(error)) {
    const retryAfter = Number(error.headers['Retry-After'] ?? 'NaN');
    return new ExecutionFailure(
      error.code,
      error.retryable && !TERMINAL_CODES.has(error.code),
      Number.isFinite(retryAfter) ? retryAfter : null,
      error.code,
    );
  }
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return new ExecutionFailure('UPSTREAM_TIMEOUT', true, null, 'timeout');
  }
  return new ExecutionFailure(
    'PROVIDER_UNAVAILABLE',
    true,
    null,
    error instanceof Error ? error.name : 'error',
  );
}

/** Opens the destination account and checks the write capability is still granted. */
export async function openDestination(
  env: ExecEnv,
  accountId: string | null,
  capability: Capability,
): Promise<{ session: ProviderSession; account: ProviderAccountRef }> {
  if (accountId === null) throw new ExecutionFailure('SOURCE_GONE', false, null, 'no_account');
  const account = await env.repo.accountRef(env.approval.user_id, accountId);
  if (account === null) throw new ExecutionFailure('SOURCE_GONE', false, null, 'account_gone');
  if (!account.capabilitiesGranted.includes(capability)) {
    throw new ExecutionFailure('PROVIDER_SCOPE_MISSING', false, null, capability);
  }
  try {
    const session = await env.sessions.open(account, {
      signal: env.signal,
      log: env.log,
      correlationId: env.correlationId,
    });
    return { session, account };
  } catch (error) {
    throw toFailure(error);
  }
}

export function outcomeResult(
  outcome: WriteOutcome,
  extra: Record<string, Json> = {},
): Record<string, Json> {
  const result: Record<string, Json> = {
    provider_id: outcome.providerId,
    already_existed: outcome.kind === 'already_exists',
    ...extra,
  };
  if ('webLink' in outcome && typeof outcome.webLink === 'string')
    result.web_link = outcome.webLink;
  if ('providerThreadId' in outcome && typeof outcome.providerThreadId === 'string') {
    result.provider_thread_id = outcome.providerThreadId;
  }
  return result;
}

export function insightRefresh(userId: string, scope: string): EnqueueInput {
  return {
    type: 'insight_refresh',
    idempotencyKey: `insight_refresh:${userId}:pending`,
    payload: { user_id: userId, scope, reason: 'approval_executed' },
    userId,
    priority: 120,
  };
}

export function calendarSync(account: ProviderAccountRef, calendarId: string | null): EnqueueInput {
  return {
    type: 'calendar_sync',
    idempotencyKey: `calendar_sync:${account.connectedAccountId}:${calendarId ?? 'all'}:pending`,
    payload: {
      connected_account_id: account.connectedAccountId,
      calendar_id: calendarId,
      trigger: 'post_write',
    },
    userId: account.userId,
    accountId: account.connectedAccountId,
    priority: 60,
  };
}

export function tasksSync(account: ProviderAccountRef): EnqueueInput {
  return {
    type: 'tasks_sync',
    idempotencyKey: `tasks_sync:${account.connectedAccountId}:pending`,
    payload: { connected_account_id: account.connectedAccountId, trigger: 'post_write' },
    userId: account.userId,
    accountId: account.connectedAccountId,
    priority: 60,
  };
}

export function mailSync(account: ProviderAccountRef): EnqueueInput {
  return account.provider === 'microsoft'
    ? {
        type: 'outlook_sync',
        idempotencyKey: `outlook_sync:${account.connectedAccountId}:sentitems:pending`,
        payload: {
          connected_account_id: account.connectedAccountId,
          folder: 'sentitems',
          trigger: 'manual',
        },
        userId: account.userId,
        accountId: account.connectedAccountId,
        priority: 60,
      }
    : {
        type: 'gmail_sync',
        idempotencyKey: `gmail_sync:${account.connectedAccountId}:pending`,
        payload: {
          connected_account_id: account.connectedAccountId,
          trigger: 'manual',
          target_history_id: null,
        },
        userId: account.userId,
        accountId: account.connectedAccountId,
        priority: 60,
      };
}
