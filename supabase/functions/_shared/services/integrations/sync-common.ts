/**
 * Shared plumbing of the sync jobs (INTEGRATION_PLAN §3.5–§3.9; API_CONTRACTS JOB-01…JOB-08):
 * - `SyncRun`: the runtime of one job (its enqueue inherits the correlation id) and its deadline, after
 *   which a job hands the rest of its work to a continuation job;
 * - sync-state resource names per provider;
 * - provider failures → `connected_accounts.status` + a `JobError` with the documented retry
 *   semantics (reauth / scope / credential failures are terminal, throttling and outages retry);
 * - the poll chain for accounts without push (demo every 5 min, unconfigured push every 10 min).
 */
import { ProviderError, type ServerProvider } from '@da/domain';
import { isAppError } from '../../errors.ts';
import { JobError, type JobContext } from '../../jobs/types.ts';
import type { Logger } from '../../logging/logger.ts';
import { enqueueResourceSync, type SyncResourceKind } from './enqueue.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { recordProviderFailure } from './status.ts';
import type { AccountRecord, SyncResource, SyncStateRecord } from './types.ts';

export interface SyncRun {
  readonly rt: IntegrationRuntime;
  readonly owner: string;
  readonly correlationId: string;
  readonly log: Logger;
  readonly signal?: AbortSignal;
  /** Epoch ms after which no new page is started in this job. */
  readonly deadline: number;
}

/** Continuation budget inside one job run (the runner's timeout is larger). */
export const RUN_BUDGET_MS = 90_000;

export function syncRunOf(
  rt: IntegrationRuntime,
  ctx: JobContext<unknown>,
  budgetMs = RUN_BUDGET_MS,
): SyncRun {
  const jobRt: IntegrationRuntime = {
    ...rt,
    enqueue: (input) => ctx.enqueue(input),
    now: () => ctx.now(),
  };
  return {
    rt: jobRt,
    owner: `job:${ctx.job.id}`,
    correlationId: ctx.correlationId,
    log: ctx.log,
    signal: ctx.signal,
    deadline: ctx.now().getTime() + budgetMs,
  };
}

export function outOfTime(run: SyncRun): boolean {
  return run.rt.now().getTime() >= run.deadline || run.signal?.aborted === true;
}

export function mailResource(
  provider: string,
  folder: 'inbox' | 'sentitems' | undefined,
): SyncResource {
  if (provider === 'microsoft')
    return folder === 'sentitems' ? 'graph_mail_sentitems' : 'graph_mail_inbox';
  return 'gmail_mailbox';
}

export function calendarResource(provider: string): SyncResource {
  return provider === 'microsoft' ? 'graph_calendar_view' : 'google_calendar';
}

export function tasksResource(provider: string): SyncResource {
  return provider === 'microsoft' ? 'todo_list' : 'google_tasks';
}

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'healthy',
  'syncing',
  'partial',
  'error',
]);

/** The account a job works on, or the reason it has nothing to do. */
export async function activeAccount(
  run: SyncRun,
  accountId: string,
): Promise<{ account: AccountRecord } | { skipped: string }> {
  const account = await run.rt.store.getAccount(accountId);
  if (account === null) return { skipped: 'account_gone' };
  if (!ACTIVE_STATUSES.has(account.status)) return { skipped: `account_${account.status}` };
  if (!['google', 'microsoft', 'demo'].includes(account.provider))
    return { skipped: 'device_account' };
  return { account };
}

export async function withLease<T>(
  run: SyncRun,
  state: SyncStateRecord,
  seconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = await run.rt.store.acquireLease(state.id, run.owner, seconds);
  if (!acquired) throw new JobError('SYNC_BUSY', true, 20, 'sync_state_leased');
  try {
    return await fn();
  } finally {
    await run.rt.store.releaseLease(state.id, run.owner);
  }
}

/** Provider / registry failure → account status + `JobError`. */
export async function failJob(
  run: SyncRun,
  account: AccountRecord,
  error: unknown,
  state?: SyncStateRecord,
): Promise<never> {
  if (error instanceof JobError) throw error;
  if (isAppError(error)) {
    if (error.code === 'EXTERNAL_CREDENTIAL_REQUIRED' || error.code === 'FEATURE_DISABLED') {
      throw new JobError(error.code, false);
    }
    throw error;
  }
  if (!(error instanceof ProviderError)) throw error;
  if (state !== undefined) {
    await run.rt.store
      .updateSyncState(state.id, {
        last_error_code: error.code,
        consecutive_failures: state.consecutive_failures + 1,
        ...(error.code === 'rate_limited' ? {} : { status: 'error' as const }),
      })
      .catch(() => undefined);
  }
  await recordProviderFailure(run.rt, account, error, run.correlationId);
  const retryAfter =
    error.retryAfterMs === null ? null : Math.max(1, Math.ceil(error.retryAfterMs / 1000));
  switch (error.code) {
    case 'auth_invalid_grant':
    case 'auth_token_rejected':
      throw new JobError('PROVIDER_REAUTH_REQUIRED', false);
    case 'scope_missing':
      throw new JobError('PROVIDER_SCOPE_MISSING', false);
    case 'consent_admin_required':
      throw new JobError('PROVIDER_ADMIN_CONSENT_REQUIRED', false);
    case 'external_credential_required':
    case 'client_credential_invalid':
      throw new JobError('EXTERNAL_CREDENTIAL_REQUIRED', false);
    case 'mailbox_unavailable':
    case 'conditional_access_blocked':
    case 'account_mismatch':
    case 'consent_denied':
      throw new JobError('PROVIDER_REJECTED', false);
    case 'rate_limited':
    case 'quota_exhausted_daily':
      throw new JobError(
        'PROVIDER_RATE_LIMITED',
        true,
        retryAfter ?? (error.code === 'quota_exhausted_daily' ? 3600 : 60),
      );
    default:
      throw new JobError('PROVIDER_UNAVAILABLE', true, retryAfter);
  }
}

/** Minutes between polls of an account without push. */
export function pollIntervalMinutes(provider: ServerProvider | string): number {
  return provider === 'demo' ? 5 : 10;
}

/** Enqueues the next poll of a resource (one job per slot; parallel chains converge). */
export async function schedulePoll(
  run: SyncRun,
  account: AccountRecord,
  resource: SyncResourceKind,
  minutes = pollIntervalMinutes(account.provider),
): Promise<string> {
  const intervalMs = minutes * 60_000;
  const runAfter = new Date(
    Math.ceil((run.rt.now().getTime() + intervalMs) / intervalMs) * intervalMs,
  );
  const slot = Math.floor(runAfter.getTime() / intervalMs);
  const type =
    resource === 'mail'
      ? account.provider === 'microsoft'
        ? 'outlook_sync'
        : 'gmail_sync'
      : resource === 'calendar'
        ? 'calendar_sync'
        : 'tasks_sync';
  const payload: Record<string, string | null> =
    resource === 'mail'
      ? account.provider === 'microsoft'
        ? { connected_account_id: account.id, folder: 'both', trigger: 'poll' }
        : { connected_account_id: account.id, trigger: 'poll', target_history_id: null }
      : resource === 'calendar'
        ? { connected_account_id: account.id, calendar_id: null, trigger: 'poll' }
        : { connected_account_id: account.id, trigger: 'poll' };
  return await run.rt.enqueue({
    type,
    idempotencyKey: `${type}:${account.id}:poll:${slot}`,
    payload,
    userId: account.user_id,
    accountId: account.id,
    runAfter,
    priority: 150,
    maxAttempts: 3,
  });
}

/** Whether a sync state has a live push watch. */
export function hasLiveWatch(state: SyncStateRecord, now: Date): boolean {
  return (
    state.watch_kind !== 'none' &&
    state.watch_expires_at !== null &&
    Date.parse(state.watch_expires_at) > now.getTime()
  );
}

export { enqueueResourceSync };
