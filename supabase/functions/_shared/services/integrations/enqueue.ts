/**
 * Job keys and payloads of the integration jobs (API_CONTRACTS §11.2, JOB-01…JOB-09, JOB-29).
 * Coalescing keys end in `:pending` (renamed on claim, so a push during a run queues exactly one
 * follow-up). `initial_sync` keys carry a hash of the continuation token and of the flow that
 * started the pass, so a reconnect gets a fresh first pass while a retried enqueue is a no-op.
 */
import type { Json } from '../../jobs/types.ts';
import { toHex } from '../../crypto/encoding.ts';
import type { IntegrationRuntime } from './runtime.ts';
import type { AccountRecord } from './types.ts';

export type SyncResourceKind = 'mail' | 'calendar' | 'tasks';
export type SyncTrigger = 'push' | 'poll' | 'manual' | 'reconcile' | 'post_write';

export interface JobRefData {
  readonly job_id: string;
  readonly status: 'queued' | 'running' | 'completed' | 'retrying' | 'failed' | 'dead_letter';
  readonly poll_after_ms: number;
}

export function jobRef(jobId: string, status: JobRefData['status'] = 'queued'): JobRefData {
  return {
    job_id: jobId,
    status,
    poll_after_ms: status === 'queued' || status === 'running' || status === 'retrying' ? 2000 : 0,
  };
}

export async function sha1Hex(value: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))),
  );
}

export interface InitialSyncPayload {
  readonly connected_account_id: string;
  readonly resource: SyncResourceKind;
  readonly phase: 'first_pass' | 'backfill' | 'resync';
  readonly window_start: string;
  readonly page_token: string | null;
  readonly folder?: 'inbox' | 'sentitems';
  /** The flow / job that started this pass (key discriminator; absent on continuations). */
  readonly origin?: string;
}

const FIRST_PASS_HOURS = 72;

export async function enqueueInitialSync(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'id' | 'user_id'>,
  input: {
    resource: SyncResourceKind;
    phase: InitialSyncPayload['phase'];
    windowStart?: string;
    pageToken?: string | null;
    folder?: 'inbox' | 'sentitems';
    origin: string;
    runAfter?: Date;
    priority?: number;
    correlationId?: string | null;
  },
): Promise<string> {
  const windowStart =
    input.windowStart ?? new Date(rt.now().getTime() - FIRST_PASS_HOURS * 3_600_000).toISOString();
  const payload: InitialSyncPayload = {
    connected_account_id: account.id,
    resource: input.resource,
    phase: input.phase,
    window_start: windowStart,
    page_token: input.pageToken ?? null,
    ...(input.folder === undefined ? {} : { folder: input.folder }),
    origin: input.origin,
  };
  const discriminator = await sha1Hex(`${input.pageToken ?? 'start'}|${input.origin}`);
  return await rt.enqueue({
    type: 'initial_sync',
    idempotencyKey: `initial_sync:${account.id}:${input.resource}:${input.phase}:${input.folder ?? '-'}:${discriminator}`,
    payload: payload as unknown as Json,
    userId: account.user_id,
    accountId: account.id,
    ...(input.runAfter === undefined ? {} : { runAfter: input.runAfter }),
    priority: input.priority ?? (input.phase === 'backfill' ? 8 : 20),
    maxAttempts: 8,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}

/** Coalesced incremental sync of one resource (JOB-02/03/04/05). */
export async function enqueueResourceSync(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'id' | 'user_id' | 'provider'>,
  resource: SyncResourceKind,
  trigger: SyncTrigger,
  opts: {
    calendarId?: string | null;
    folder?: 'inbox' | 'sentitems' | 'both';
    historyId?: string | null;
    runAfter?: Date;
    correlationId?: string | null;
  } = {},
): Promise<string> {
  const common = {
    userId: account.user_id,
    accountId: account.id,
    ...(opts.runAfter === undefined ? {} : { runAfter: opts.runAfter }),
    ...(opts.correlationId === undefined ? {} : { correlationId: opts.correlationId }),
  };
  if (resource === 'mail') {
    if (account.provider === 'microsoft') {
      const folder = opts.folder ?? 'both';
      return await rt.enqueue({
        type: 'outlook_sync',
        idempotencyKey: `outlook_sync:${account.id}:${folder}:pending`,
        payload: {
          connected_account_id: account.id,
          folder,
          trigger: trigger === 'post_write' ? 'manual' : trigger,
        },
        priority: trigger === 'manual' ? 30 : 60,
        maxAttempts: 6,
        ...common,
      });
    }
    return await rt.enqueue({
      type: 'gmail_sync',
      idempotencyKey: `gmail_sync:${account.id}:pending`,
      payload: {
        connected_account_id: account.id,
        trigger: trigger === 'post_write' ? 'manual' : trigger,
        target_history_id: opts.historyId ?? null,
      },
      priority: trigger === 'manual' ? 30 : 60,
      maxAttempts: 6,
      ...common,
    });
  }
  if (resource === 'calendar') {
    const calendarId = opts.calendarId ?? null;
    return await rt.enqueue({
      type: 'calendar_sync',
      idempotencyKey: `calendar_sync:${account.id}:${calendarId ?? 'all'}:pending`,
      payload: { connected_account_id: account.id, calendar_id: calendarId, trigger },
      priority: trigger === 'manual' || trigger === 'post_write' ? 30 : 60,
      maxAttempts: 6,
      ...common,
    });
  }
  return await rt.enqueue({
    type: 'tasks_sync',
    idempotencyKey: `tasks_sync:${account.id}:pending`,
    payload: {
      connected_account_id: account.id,
      trigger: trigger === 'push' || trigger === 'reconcile' ? 'poll' : trigger,
    },
    priority: trigger === 'manual' || trigger === 'post_write' ? 30 : 100,
    maxAttempts: 5,
    ...common,
  });
}

export type WatchResource =
  'gmail' | 'gcal_channel' | 'graph_mail_inbox' | 'graph_mail_sent' | 'graph_calendar';
export type WatchMode = 'create' | 'renew' | 'reauthorize' | 'recreate' | 'stop';

export async function enqueueWatch(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'id' | 'user_id'>,
  input: {
    resource: WatchResource;
    calendarId?: string | null;
    mode: WatchMode;
    syncStateId?: string | null;
    correlationId?: string | null;
    bucket?: string;
  },
): Promise<string> {
  const day = input.bucket ?? rt.now().toISOString().slice(0, 10);
  return await rt.enqueue({
    type: 'watch_renewal',
    idempotencyKey: `watch_renewal:${account.id}:${input.resource}:${input.calendarId ?? '-'}:${input.mode}:${day}`,
    payload: {
      connected_account_id: account.id,
      resource: input.resource,
      calendar_id: input.calendarId ?? null,
      mode: input.mode,
      ...(input.syncStateId === undefined || input.syncStateId === null
        ? {}
        : { sync_state_id: input.syncStateId }),
    },
    userId: account.user_id,
    accountId: account.id,
    priority: 40,
    maxAttempts: 6,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}

/** JOB-12 `insight_refresh` (coalesced per user). */
export async function enqueueInsightRefresh(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'user_id'>,
  scope: 'mail' | 'calendar' | 'tasks' | 'all',
  reason: string,
): Promise<string> {
  return await rt.enqueue({
    type: 'insight_refresh',
    idempotencyKey: `insight_refresh:${account.user_id}:pending`,
    payload: { user_id: account.user_id, scope, reason: reason.slice(0, 40) },
    userId: account.user_id,
    priority: 120,
    maxAttempts: 5,
  });
}

/** JOB-10 `email_triage` in batches of ≤ 50 new messages. */
export async function enqueueTriage(
  rt: IntegrationRuntime,
  account: Pick<AccountRecord, 'id' | 'user_id'>,
  messageIds: readonly string[],
  origin: 'initial' | 'incremental' | 'resync',
  correlationId?: string | null,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < messageIds.length; i += 50) {
    const batch = messageIds.slice(i, i + 50);
    const key = await sha1Hex(batch.join(','));
    ids.push(
      await rt.enqueue({
        type: 'email_triage',
        idempotencyKey: `email_triage:${account.id}:${key}`,
        payload: { connected_account_id: account.id, email_message_ids: [...batch], origin },
        userId: account.user_id,
        accountId: account.id,
        priority: origin === 'incremental' ? 40 : 60,
        maxAttempts: 5,
        ...(correlationId === undefined || correlationId === null ? {} : { correlationId }),
      }),
    );
  }
  return ids;
}
