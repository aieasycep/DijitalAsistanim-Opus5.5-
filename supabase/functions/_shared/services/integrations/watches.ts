/**
 * Push watches (API_CONTRACTS JOB-07 `watch_renewal`, JOB-08 `reconciliation`, JOB-09
 * `provider_webhook`; INTEGRATION_PLAN §3.10–§3.12, §4.3, §5.4; T-4.03, T-4.04, T-4.09, T-4.12).
 *
 * - Gmail `users.watch` (Pub/Sub), Google Calendar channels and Graph subscriptions are created after
 *   the first pass, renewed a day before they expire, reauthorized on `reauthorizationRequired`
 *   (at most once per 10 minutes), recreated after `subscriptionRemoved` and stopped on deselect /
 *   disconnect. Without push configuration the watch is skipped and the account is polled.
 * - Reconciliation (daily and after gaps): token health, credential re-encryption, held token sets of
 *   abandoned reconnects dropped, missing / expiring watches, orphan channels of deselected calendars,
 *   and a catch-up sync of any resource whose last success is older than 6 hours.
 */
import {
  type CalendarProvider,
  type MailProvider,
  ProviderError,
  type WatchHandle,
} from '@da/domain';
import { reencryptToActive } from '../../crypto/token-cipher.ts';
import type { JobResult } from '../../jobs/types.ts';
import { providerContextFor } from './context.ts';
import {
  enqueueResourceSync,
  enqueueWatch,
  type SyncResourceKind,
  type WatchMode,
  type WatchResource,
} from './enqueue.ts';
import {
  activeAccount,
  failJob,
  hasLiveWatch,
  schedulePoll,
  type SyncRun,
  withLease,
} from './sync-common.ts';
import type {
  AccountRecord,
  CalendarRecord,
  SyncResource,
  SyncStateRecord,
  WatchKind,
} from './types.ts';

const DAY = 86_400_000;
const REAUTH_GUARD_MS = 10 * 60_000;

const RESOURCE_OF: Readonly<Record<WatchResource, SyncResource>> = {
  gmail: 'gmail_mailbox',
  gcal_channel: 'google_calendar',
  graph_mail_inbox: 'graph_mail_inbox',
  graph_mail_sent: 'graph_mail_sentitems',
  graph_calendar: 'graph_calendar_view',
};

const WATCH_OF: Readonly<
  Partial<Record<SyncResource, { resource: WatchResource; kind: WatchKind }>>
> = {
  gmail_mailbox: { resource: 'gmail', kind: 'gmail_watch' },
  google_calendar: { resource: 'gcal_channel', kind: 'gcal_channel' },
  graph_mail_inbox: { resource: 'graph_mail_inbox', kind: 'graph_subscription' },
  graph_mail_sentitems: { resource: 'graph_mail_sent', kind: 'graph_subscription' },
  graph_calendar_view: { resource: 'graph_calendar', kind: 'graph_subscription' },
};

export interface WatchRenewalPayload {
  readonly connected_account_id?: string;
  readonly resource?: WatchResource;
  readonly calendar_id?: string | null;
  readonly mode?: WatchMode;
  readonly sync_state_id?: string;
}

type Watchable = MailProvider | CalendarProvider;

function handleOf(state: SyncStateRecord, calendar: CalendarRecord | null): WatchHandle {
  return {
    resource: state.resource,
    resourceKey:
      calendar?.provider_calendar_id ??
      (state.resource === 'graph_mail_sentitems'
        ? 'sentitems'
        : state.resource === 'graph_mail_inbox'
          ? 'inbox'
          : ''),
    watchId: state.watch_id ?? '',
    providerResourceId: state.watch_resource_id,
    expiresAt: state.watch_expires_at ?? new Date(0).toISOString(),
    tokenHash: state.watch_token_hash,
  };
}

function renewAfter(expiresAt: string, now: Date): string {
  const expires = Date.parse(expiresAt);
  return new Date(
    Math.max(now.getTime() + 60 * 60_000, Math.min(expires - DAY, now.getTime() + DAY)),
  ).toISOString();
}

function clearedWatch() {
  return {
    watch_kind: 'none' as const,
    watch_id: null,
    watch_resource_id: null,
    watch_token_hash: null,
    watch_history_id: null,
    watch_expires_at: null,
    watch_renew_after: null,
  };
}

function watchable(run: SyncRun, account: AccountRecord, resource: SyncResource): Watchable {
  const adapters = run.rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  const adapter =
    resource === 'gmail_mailbox' ||
    resource === 'graph_mail_inbox' ||
    resource === 'graph_mail_sentitems'
      ? adapters.mail
      : adapters.calendar;
  if (adapter === undefined)
    throw new ProviderError('external_credential_required', null, null, 'adapter_missing');
  return adapter;
}

function reauthorizer(
  adapter: Watchable,
): ((ctx: Parameters<Watchable['stopWatch']>[0], handle: WatchHandle) => Promise<void>) | null {
  const candidate = (
    adapter as unknown as {
      reauthorizeWatch?: (ctx: unknown, handle: WatchHandle) => Promise<void>;
    }
  ).reauthorizeWatch;
  return typeof candidate === 'function'
    ? (ctx, handle) => candidate.call(adapter, ctx, handle)
    : null;
}

/** JOB-07. */
export async function runWatchRenewal(
  run: SyncRun,
  payload: WatchRenewalPayload,
): Promise<JobResult> {
  let state: SyncStateRecord | null = null;
  let accountId = payload.connected_account_id ?? null;
  if (payload.sync_state_id !== undefined) {
    state = await run.rt.store.getSyncState(payload.sync_state_id);
    if (state === null) return { skipped: 'sync_state_gone' };
    accountId = state.connected_account_id;
  }
  if (accountId === null) return { skipped: 'no_account' };
  const mode: WatchMode = payload.mode ?? 'renew';
  const account = await run.rt.store.getAccount(accountId);
  if (account === null) return { skipped: 'account_gone' };
  if (mode !== 'stop' && !['healthy', 'syncing', 'partial', 'error'].includes(account.status))
    return { skipped: `account_${account.status}` };
  if (account.provider === 'demo') return { skipped: 'demo_polls' };

  let calendar: CalendarRecord | null = null;
  if (state === null) {
    if (payload.resource === undefined) return { skipped: 'no_resource' };
    const resource = RESOURCE_OF[payload.resource];
    if (resource === 'google_calendar' || resource === 'graph_calendar_view') {
      if (payload.calendar_id === null || payload.calendar_id === undefined)
        return { skipped: 'no_calendar' };
      calendar = await run.rt.store.getCalendar(payload.calendar_id);
      if (calendar === null || calendar.connected_account_id !== account.id)
        return { skipped: 'calendar_gone' };
      state = await run.rt.store.ensureSyncState({
        userId: account.user_id,
        accountId: account.id,
        resource,
        resourceKey: calendar.id,
        calendarId: calendar.id,
      });
    } else {
      state = await run.rt.store.ensureSyncState({
        userId: account.user_id,
        accountId: account.id,
        resource,
        resourceKey: '',
      });
    }
  } else if (state.calendar_id !== null) {
    calendar = await run.rt.store.getCalendar(state.calendar_id);
  }
  const watch = WATCH_OF[state.resource];
  if (watch === undefined) return { skipped: 'not_watchable' };
  const current: SyncStateRecord = state;
  if (mode !== 'stop' && calendar !== null && !calendar.selected) {
    // A deselected calendar keeps no channel.
    return await runWatchRenewal(run, { sync_state_id: current.id, mode: 'stop' });
  }

  try {
    const adapter = watchable(run, account, current.resource);
    const ctx = await providerContextFor(run.rt, account, {
      owner: run.owner,
      correlationId: run.correlationId,
      log: run.log,
      ...(run.signal === undefined ? {} : { signal: run.signal }),
    });
    return await withLease(run, current, 60, async (): Promise<JobResult> => {
      const now = run.rt.now();
      const store = async (handle: WatchHandle) => {
        await run.rt.store.updateSyncState(current.id, {
          watch_kind: watch.kind,
          watch_id: handle.watchId,
          watch_resource_id: watch.kind === 'gmail_watch' ? null : handle.providerResourceId,
          watch_history_id: watch.kind === 'gmail_watch' ? handle.providerResourceId : null,
          watch_token_hash: handle.tokenHash,
          watch_expires_at: handle.expiresAt,
          watch_renew_after: renewAfter(handle.expiresAt, now),
        });
      };
      const create = async () => {
        const key =
          calendar?.provider_calendar_id ??
          (current.resource === 'graph_mail_sentitems' ? 'sentitems' : 'inbox');
        await store(await adapter.watch(ctx, key));
      };
      const stop = async () => {
        if (current.watch_kind === 'none' || current.watch_id === null) return;
        try {
          await adapter.stopWatch(ctx, handleOf(current, calendar));
        } catch (error) {
          if (!(error instanceof ProviderError && error.code === 'not_found')) throw error;
        }
      };
      try {
        switch (mode) {
          case 'create':
            if (hasLiveWatch(current, now)) return { skipped: 'already_watching' };
            await create();
            return { created: true };
          case 'renew':
            if (current.watch_kind === 'none' || current.watch_id === null) {
              await create();
              return { created: true };
            }
            try {
              await store(await adapter.renewWatch(ctx, handleOf(current, calendar)));
            } catch (error) {
              if (!(error instanceof ProviderError && error.code === 'not_found')) throw error;
              await create();
            }
            return { renewed: true };
          case 'reauthorize': {
            const last = current.stats.last_reauth_epoch ?? 0;
            if (now.getTime() - last < REAUTH_GUARD_MS) return { skipped: 'reauth_guard' };
            const reauth = reauthorizer(adapter);
            if (reauth !== null && current.watch_id !== null)
              await reauth(ctx, handleOf(current, calendar));
            await store(await adapter.renewWatch(ctx, handleOf(current, calendar)));
            await run.rt.store.updateSyncState(current.id, {
              stats: { ...current.stats, last_reauth_epoch: now.getTime() },
            });
            return { reauthorized: true };
          }
          case 'recreate': {
            await stop();
            await run.rt.store.updateSyncState(current.id, clearedWatch());
            await create();
            const kind: SyncResourceKind = current.resource.includes('calendar')
              ? 'calendar'
              : 'mail';
            await enqueueResourceSync(run.rt, account, kind, 'reconcile', {
              calendarId: calendar?.id ?? null,
              folder:
                current.resource === 'graph_mail_sentitems'
                  ? 'sentitems'
                  : current.resource === 'graph_mail_inbox'
                    ? 'inbox'
                    : undefined,
              correlationId: run.correlationId,
            });
            return { recreated: true };
          }
          case 'stop':
            await stop();
            await run.rt.store.updateSyncState(current.id, clearedWatch());
            return { stopped: true };
        }
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'external_credential_required') {
          // Push is not configured (Pub/Sub topic, calendar webhook or Graph webhook URLs): poll.
          await schedulePoll(
            run,
            account,
            current.resource.includes('calendar') ? 'calendar' : 'mail',
          );
          return { skipped: 'not_configured' };
        }
        throw error;
      }
      return { skipped: 'unknown_mode' };
    });
  } catch (error) {
    return await failJob(run, account, error, current);
  }
}

export interface ReconciliationPayload {
  readonly connected_account_id?: string;
  readonly account_id?: string;
  readonly reason?: 'daily' | 'missed' | 'subscription_removed' | 'resync_404' | 'manual' | 'admin';
}

const STALE_MS = 6 * 3_600_000;

/** JOB-08. */
export async function runReconciliation(
  run: SyncRun,
  payload: ReconciliationPayload,
): Promise<JobResult> {
  const accountId = payload.connected_account_id ?? payload.account_id;
  if (accountId === undefined) return { skipped: 'no_account' };
  const found = await activeAccount(run, accountId);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  const result: Record<string, number | boolean | string> = { reason: payload.reason ?? 'daily' };

  // Abandoned reconnect / upgrade flows: drop their held token sets.
  for (const state of await run.rt.store.expiredHeldStates(account.id)) {
    await run.rt.store.closeFlow(state.id, state.result ?? 'error', 'binding_expired');
    result.held_states_dropped = Number(result.held_states_dropped ?? 0) + 1;
  }

  const keyring = await run.rt.keyring();
  try {
    // 1 · token health (refreshes a token expiring soon; invalid_grant → needs_reauth).
    const ctx = await providerContextFor(run.rt, account, {
      owner: run.owner,
      correlationId: run.correlationId,
      log: run.log,
      ...(run.signal === undefined ? {} : { signal: run.signal }),
    });
    await ctx.tokens.get();
    // 2 · re-encrypt to the active key version.
    for (const kind of ['refresh', 'access'] as const) {
      const row = await run.rt.store.getCredential(account.id, kind);
      if (row === null) continue;
      const next = await reencryptToActive(keyring, row, {
        account: account.id,
        provider: account.provider,
        kind,
      });
      if (next !== null) {
        await run.rt.store.saveCredential(account, {
          kind,
          token: next,
          accessExpiresAt: row.access_expires_at,
          scopeSnapshot: null,
        });
        result.reencrypted = Number(result.reencrypted ?? 0) + 1;
      }
    }
  } catch (error) {
    return await failJob(run, account, error);
  }

  // 3 · watches and staleness per resource.
  const now = run.rt.now();
  const states = await run.rt.store.listSyncStates(account.id);
  const calendars = new Map(
    (await run.rt.store.listCalendars(account.id)).map((c) => [c.id, c] as const),
  );
  const staleKinds = new Set<SyncResourceKind>();
  for (const state of states) {
    const watch = WATCH_OF[state.resource];
    const calendar = state.calendar_id === null ? null : (calendars.get(state.calendar_id) ?? null);
    if (calendar !== null && !calendar.selected) {
      if (state.watch_kind !== 'none') {
        await enqueueWatch(run.rt, account, {
          resource: watch?.resource ?? 'gcal_channel',
          calendarId: calendar.id,
          mode: 'stop',
          correlationId: run.correlationId,
        });
        result.orphans_stopped = Number(result.orphans_stopped ?? 0) + 1;
      }
      continue;
    }
    if (watch !== undefined && account.provider !== 'demo') {
      const expiresSoon =
        state.watch_expires_at !== null && Date.parse(state.watch_expires_at) - now.getTime() < DAY;
      if (state.watch_kind === 'none' || !hasLiveWatch(state, now) || expiresSoon) {
        await enqueueWatch(run.rt, account, {
          resource: watch.resource,
          calendarId: state.calendar_id,
          mode: state.watch_kind === 'none' ? 'create' : 'renew',
          correlationId: run.correlationId,
        });
        result.watches_enqueued = Number(result.watches_enqueued ?? 0) + 1;
      }
    }
    const last = state.last_success_at === null ? 0 : Date.parse(state.last_success_at);
    if (
      payload.reason === 'missed' ||
      payload.reason === 'subscription_removed' ||
      now.getTime() - last > STALE_MS
    ) {
      staleKinds.add(
        state.resource.includes('calendar')
          ? 'calendar'
          : state.resource.includes('mail')
            ? 'mail'
            : 'tasks',
      );
    }
  }
  for (const kind of staleKinds) {
    const cap =
      kind === 'mail' ? 'mail_read' : kind === 'calendar' ? 'calendar_read' : 'tasks_read';
    if (!account.capabilities_granted.includes(cap)) continue;
    await enqueueResourceSync(run.rt, account, kind, 'reconcile', {
      correlationId: run.correlationId,
    });
    result[`sync_${kind}`] = true;
  }
  return result;
}

export interface ProviderWebhookPayload {
  readonly webhook_event_id: string;
  readonly source: 'gmail_pubsub' | 'gcal_channel' | 'graph_notification' | 'graph_lifecycle';
  readonly connected_account_id: string;
  readonly data: {
    readonly history_id?: string;
    readonly calendar_id?: string;
    readonly folder?: string;
    readonly lifecycle_event?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';
    readonly sync_state_id?: string;
  };
}

/** JOB-09: a verified webhook event → the coalesced sync (or watch / reconciliation) it implies. */
export async function runProviderWebhook(
  run: SyncRun,
  payload: ProviderWebhookPayload,
  markEvent: (id: string, status: 'enqueued' | 'ignored', jobId: string | null) => Promise<void>,
): Promise<JobResult> {
  const found = await activeAccount(run, payload.connected_account_id);
  if ('skipped' in found) {
    await markEvent(payload.webhook_event_id, 'ignored', null);
    return { skipped: found.skipped };
  }
  const account = found.account;
  let jobId: string;
  switch (payload.source) {
    case 'gmail_pubsub':
      jobId = await enqueueResourceSync(run.rt, account, 'mail', 'push', {
        historyId: payload.data.history_id ?? null,
        correlationId: run.correlationId,
      });
      break;
    case 'gcal_channel':
      jobId = await enqueueResourceSync(run.rt, account, 'calendar', 'push', {
        calendarId: payload.data.calendar_id ?? null,
        correlationId: run.correlationId,
      });
      break;
    case 'graph_notification':
      jobId =
        payload.data.calendar_id !== undefined
          ? await enqueueResourceSync(run.rt, account, 'calendar', 'push', {
              calendarId: payload.data.calendar_id,
              correlationId: run.correlationId,
            })
          : await enqueueResourceSync(run.rt, account, 'mail', 'push', {
              folder: payload.data.folder === 'sentitems' ? 'sentitems' : 'inbox',
              correlationId: run.correlationId,
            });
      break;
    case 'graph_lifecycle': {
      const event = payload.data.lifecycle_event;
      const state =
        payload.data.sync_state_id === undefined
          ? null
          : await run.rt.store.getSyncState(payload.data.sync_state_id);
      const watch = state === null ? undefined : WATCH_OF[state.resource];
      const bucket = String(Math.floor(run.rt.now().getTime() / REAUTH_GUARD_MS));
      if (event === 'missed' || state === null || watch === undefined) {
        jobId = await run.rt.enqueue({
          type: 'reconciliation',
          idempotencyKey: `reconciliation:${account.id}:missed:${bucket}`,
          payload: { connected_account_id: account.id, reason: 'missed' },
          userId: account.user_id,
          accountId: account.id,
          priority: 60,
          maxAttempts: 5,
        });
        break;
      }
      jobId = await enqueueWatch(run.rt, account, {
        resource: watch.resource,
        calendarId: state.calendar_id,
        mode: event === 'reauthorizationRequired' ? 'reauthorize' : 'recreate',
        syncStateId: state.id,
        bucket: `${state.watch_id ?? state.id}:${bucket}`,
        correlationId: run.correlationId,
      });
      if (event === 'subscriptionRemoved') {
        await run.rt.enqueue({
          type: 'reconciliation',
          idempotencyKey: `reconciliation:${account.id}:subscription_removed:${bucket}`,
          payload: { connected_account_id: account.id, reason: 'subscription_removed' },
          userId: account.user_id,
          accountId: account.id,
          priority: 60,
          maxAttempts: 5,
        });
      }
      break;
    }
  }
  await markEvent(payload.webhook_event_id, 'enqueued', jobId);
  await run.rt.poke('provider_webhook');
  return { job_id: jobId };
}
