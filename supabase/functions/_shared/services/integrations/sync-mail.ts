/**
 * Mail sync (API_CONTRACTS JOB-01 mail, JOB-02 `gmail_sync`, JOB-03 `outlook_sync`; INTEGRATION_PLAN
 * §3.5, §4.3, §5.3, §13.2; T-4.03, T-4.07, T-4.10, T-4.12).
 *
 * First pass / resync / backfill:
 * - Gmail: `getProfile` → starting `historyId` (the incremental cursor), then `messages.list`
 *   (inbox, then sent) + metadata gets;
 * - Graph and demo: a per-folder delta baseline filtered to the window; the final page's delta link /
 *   clock is the incremental cursor. Backfill uses the list path for every provider.
 * Incremental: `changesSince(cursor)` pages; Gmail history ids need a metadata get; `@removed` /
 * `messageDeleted` → `provider_deleted_at`; label changes → labels / read state. An invalid cursor
 * (Gmail 404, Graph 410 / `syncStateNotFound`) → `initial_sync {phase:'resync'}` over 7 days.
 * Every job stops starting new pages at its deadline and continues in a new job. New messages go
 * to `email_triage` in batches of ≤ 50. Only the stored subset is written: no body is fetched here.
 */
import {
  type MailCursor,
  type MailProvider,
  type NormalizedMailMessage,
  type ProviderContext,
  ProviderError,
} from '@da/domain';
import type { JobResult } from '../../jobs/types.ts';
import { providerContextFor } from './context.ts';
import {
  enqueueInitialSync,
  enqueueInsightRefresh,
  enqueueTriage,
  enqueueWatch,
  sha1Hex,
  type InitialSyncPayload,
} from './enqueue.ts';
import { mailRowOf } from './rows.ts';
import { recordSyncSuccess, togglesOf } from './status.ts';
import {
  activeAccount,
  failJob,
  hasLiveWatch,
  mailResource,
  outOfTime,
  schedulePoll,
  type SyncRun,
  withLease,
} from './sync-common.ts';
import type { AccountRecord, SyncStateRecord } from './types.ts';

const BACKFILL_DAYS = 14;
const RESYNC_DAYS = 7;
const METADATA_CHUNK = 50;

type Folder = 'inbox' | 'sentitems';

function cursorKind(provider: string): MailCursor['kind'] {
  return provider === 'microsoft'
    ? 'graph_delta'
    : provider === 'demo'
      ? 'demo_clock'
      : 'gmail_history';
}

function mailAdapter(run: SyncRun, account: AccountRecord): MailProvider {
  const adapters = run.rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  if (adapters.mail === undefined)
    throw new ProviderError('external_credential_required', null, null, 'mail_adapter_missing');
  return adapters.mail;
}

/** Mail ingestion is paused by the data-source toggle or a plan downgrade (JOB-02 step 1). */
export async function mailPaused(run: SyncRun, account: AccountRecord): Promise<boolean> {
  if (!account.capabilities_granted.includes('mail_read')) return true;
  if (!togglesOf(account).mail_read) return true;
  return await run.rt.store.pausedByPlan(account.id);
}

async function storeMessages(
  run: SyncRun,
  ctx: ProviderContext,
  adapter: MailProvider,
  account: AccountRecord,
  messages: readonly NormalizedMailMessage[],
): Promise<string[]> {
  if (messages.length === 0) return [];
  const rows = [];
  for (const m of messages) rows.push(await mailRowOf(m, m.webLink ?? adapter.webLinkFor(ctx, m)));
  const inserted: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const result = await run.rt.store.upsertMail(account.id, rows.slice(i, i + 500));
    for (const r of result) if (r.inserted) inserted.push(r.id);
  }
  return inserted;
}

async function fetchMetadata(
  ctx: ProviderContext,
  adapter: MailProvider,
  ids: readonly string[],
): Promise<NormalizedMailMessage[]> {
  const out: NormalizedMailMessage[] = [];
  for (let i = 0; i < ids.length; i += METADATA_CHUNK) {
    const got = await adapter.getMessagesMetadata(ctx, ids.slice(i, i + METADATA_CHUNK));
    for (const m of got) if (!('notFound' in m)) out.push(m);
  }
  return out;
}

async function finishPass(
  run: SyncRun,
  account: AccountRecord,
  state: SyncStateRecord,
  payload: InitialSyncPayload,
  counts: { stored: number },
): Promise<JobResult> {
  const now = run.rt.now().toISOString();
  await run.rt.store.updateSyncState(state.id, {
    status: 'idle',
    page_token: null,
    backfill_cursor: null,
    last_full_sync_at: now,
    last_success_at: now,
    consecutive_failures: 0,
    last_error_code: null,
    cursor_invalidated_at: null,
  });
  if (payload.phase === 'backfill') return { phase: 'backfill', stored: counts.stored, done: true };
  const fresh = (await run.rt.store.getAccount(account.id)) ?? account;
  await recordSyncSuccess(run.rt, fresh, { finishedFirstPass: payload.phase === 'first_pass' });
  if (account.provider === 'google') {
    await enqueueWatch(run.rt, account, {
      resource: 'gmail',
      mode: 'create',
      correlationId: run.correlationId,
    });
  } else if (account.provider === 'microsoft') {
    await enqueueWatch(run.rt, account, {
      resource: payload.folder === 'sentitems' ? 'graph_mail_sent' : 'graph_mail_inbox',
      mode: 'create',
      correlationId: run.correlationId,
    });
  }
  if (
    payload.phase === 'first_pass' &&
    (payload.folder === undefined || payload.folder === 'inbox')
  ) {
    await enqueueInitialSync(run.rt, account, {
      resource: 'mail',
      phase: 'backfill',
      windowStart: new Date(
        Date.parse(payload.window_start) - BACKFILL_DAYS * 86_400_000,
      ).toISOString(),
      origin: `backfill:${payload.window_start}`,
      correlationId: run.correlationId,
    });
  }
  await schedulePoll(run, account, 'mail');
  return { phase: payload.phase, stored: counts.stored, done: true };
}

async function continuePass(
  run: SyncRun,
  account: AccountRecord,
  payload: InitialSyncPayload,
  next: { pageToken: string | null; folder?: Folder },
): Promise<JobResult> {
  await enqueueInitialSync(run.rt, account, {
    resource: 'mail',
    phase: payload.phase,
    windowStart: payload.window_start,
    pageToken: next.pageToken,
    origin: payload.origin ?? 'continuation',
    correlationId: run.correlationId,
    ...(next.folder === undefined ? {} : { folder: next.folder }),
  });
  return { phase: payload.phase, continued: true };
}

/** List path: Gmail first pass / resync and every provider's backfill. */
async function listPass(
  run: SyncRun,
  ctx: ProviderContext,
  adapter: MailProvider,
  account: AccountRecord,
  state: SyncStateRecord,
  payload: InitialSyncPayload,
): Promise<JobResult> {
  const counts = { stored: 0 };
  let folder: Folder = payload.folder ?? 'inbox';
  let pageToken = payload.page_token;
  const receivedBefore =
    payload.phase === 'backfill'
      ? new Date(Date.parse(payload.window_start) + BACKFILL_DAYS * 86_400_000).toISOString()
      : undefined;

  if (
    payload.phase !== 'backfill' &&
    pageToken === null &&
    folder === 'inbox' &&
    account.provider === 'google'
  ) {
    const profile = await adapter.getProfile(ctx);
    if (profile.mailboxCursorHint !== null) {
      await run.rt.store.updateSyncState(state.id, {
        cursor: profile.mailboxCursorHint,
        status: 'backfilling',
      });
    }
  }
  const folders: Folder[] =
    account.provider === 'microsoft' && payload.phase === 'backfill'
      ? [folder]
      : folder === 'inbox'
        ? ['inbox', 'sentitems']
        : ['sentitems'];
  for (const f of folders) {
    folder = f;
    while (true) {
      const page = await adapter.listMessageIds(
        ctx,
        {
          folder: f === 'sentitems' ? 'sent' : 'inbox',
          receivedAfter: payload.window_start,
          ...(receivedBefore === undefined ? {} : { receivedBefore }),
          excludeBulkCategories: false,
        },
        pageToken,
      );
      const messages = await fetchMetadata(
        ctx,
        adapter,
        page.items.map((i) => i.id),
      );
      const inserted = await storeMessages(run, ctx, adapter, account, messages);
      counts.stored += messages.length;
      if (inserted.length > 0)
        await enqueueTriage(
          run.rt,
          account,
          inserted,
          payload.phase === 'resync' ? 'resync' : 'initial',
          run.correlationId,
        );
      pageToken = page.nextPageToken;
      if (pageToken === null) break;
      if (outOfTime(run))
        return await continuePass(run, account, payload, { pageToken, folder: f });
    }
    pageToken = null;
    if (f === 'inbox' && folders.includes('sentitems') && outOfTime(run)) {
      return await continuePass(run, account, payload, { pageToken: null, folder: 'sentitems' });
    }
  }
  return await finishPass(run, account, state, payload, counts);
}

/** Delta path: Graph and demo first pass / resync (per folder). */
async function deltaPass(
  run: SyncRun,
  ctx: ProviderContext,
  adapter: MailProvider,
  account: AccountRecord,
  state: SyncStateRecord,
  payload: InitialSyncPayload,
): Promise<JobResult> {
  const counts = { stored: 0 };
  const folder: Folder | undefined =
    account.provider === 'microsoft' ? (payload.folder ?? 'inbox') : undefined;
  let cursor: MailCursor;
  if (payload.page_token === null || state.backfill_cursor === null) {
    cursor = await adapter.baseline(ctx, folder ?? 'inbox');
    if (folder === undefined) cursor = { kind: cursor.kind, value: cursor.value };
    await run.rt.store.updateSyncState(state.id, {
      backfill_cursor: JSON.stringify(cursor),
      status: 'backfilling',
    });
  } else {
    cursor = JSON.parse(state.backfill_cursor) as MailCursor;
  }
  let pageToken = payload.page_token;
  while (true) {
    const set = await adapter.changesSince(ctx, cursor, pageToken);
    const inserted = await storeMessages(run, ctx, adapter, account, set.upserts);
    counts.stored += set.upserts.length;
    if (inserted.length > 0)
      await enqueueTriage(
        run.rt,
        account,
        inserted,
        payload.phase === 'resync' ? 'resync' : 'initial',
        run.correlationId,
      );
    if (set.deleted.length > 0) await run.rt.store.applyMailChanges(account.id, [], set.deleted);
    pageToken = set.pageToken;
    if (pageToken === null) {
      await run.rt.store.updateSyncState(state.id, { cursor: set.nextCursor.value });
      break;
    }
    if (outOfTime(run)) {
      return await continuePass(run, account, payload, {
        pageToken,
        ...(folder === undefined ? {} : { folder }),
      });
    }
  }
  return await finishPass(run, account, state, payload, counts);
}

/** JOB-01, resource `mail`. */
export async function runInitialMail(
  run: SyncRun,
  payload: InitialSyncPayload,
): Promise<JobResult> {
  const found = await activeAccount(run, payload.connected_account_id);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  if (await mailPaused(run, account)) return { skipped: 'paused' };
  const folder = account.provider === 'microsoft' ? (payload.folder ?? 'inbox') : undefined;
  const state = await run.rt.store.ensureSyncState({
    userId: account.user_id,
    accountId: account.id,
    resource: mailResource(account.provider, folder),
    resourceKey: '',
  });
  try {
    const adapter = mailAdapter(run, account);
    const ctx = await providerContextFor(run.rt, account, {
      owner: run.owner,
      correlationId: run.correlationId,
      log: run.log,
      ...(run.signal === undefined ? {} : { signal: run.signal }),
    });
    return await withLease(run, state, 240, async () => {
      if (payload.phase === 'backfill' || account.provider === 'google') {
        return await listPass(run, ctx, adapter, account, state, payload);
      }
      return await deltaPass(run, ctx, adapter, account, state, payload);
    });
  } catch (error) {
    return await failJob(run, account, error, state);
  }
}

export interface MailSyncPayload {
  readonly connected_account_id: string;
  readonly trigger: 'push' | 'poll' | 'manual' | 'reconcile';
  readonly target_history_id?: string | null;
  readonly folder?: 'inbox' | 'sentitems' | 'both';
}

function historyReached(cursor: string, target: string | null | undefined): boolean {
  if (target === null || target === undefined || !/^\d+$/.test(target) || !/^\d+$/.test(cursor))
    return false;
  return BigInt(cursor) >= BigInt(target);
}

/** JOB-02 / JOB-03 (and the demo poll): incremental changes since the stored cursor. */
export async function runMailSync(run: SyncRun, payload: MailSyncPayload): Promise<JobResult> {
  const found = await activeAccount(run, payload.connected_account_id);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  if (await mailPaused(run, account)) return { skipped: 'paused' };
  const folders: (Folder | undefined)[] =
    account.provider === 'microsoft'
      ? payload.folder === 'inbox' || payload.folder === 'sentitems'
        ? [payload.folder]
        : ['inbox', 'sentitems']
      : [undefined];
  const result: Record<string, number | string | boolean> = {
    upserts: 0,
    deleted: 0,
    label_changes: 0,
  };
  let adapter: MailProvider;
  let ctx: ProviderContext;
  try {
    adapter = mailAdapter(run, account);
    ctx = await providerContextFor(run.rt, account, {
      owner: run.owner,
      correlationId: run.correlationId,
      log: run.log,
      ...(run.signal === undefined ? {} : { signal: run.signal }),
    });
  } catch (error) {
    return await failJob(run, account, error);
  }
  let polling = false;
  for (const folder of folders) {
    const state = await run.rt.store.ensureSyncState({
      userId: account.user_id,
      accountId: account.id,
      resource: mailResource(account.provider, folder),
      resourceKey: '',
    });
    if (!hasLiveWatch(state, run.rt.now())) polling = true;
    if (state.cursor === null) {
      if (state.status !== 'backfilling') {
        await enqueueInitialSync(run.rt, account, {
          resource: 'mail',
          phase: 'first_pass',
          origin: `missing_cursor:${state.id}`,
          correlationId: run.correlationId,
          ...(folder === undefined ? {} : { folder }),
        });
      }
      result.initial_sync = true;
      continue;
    }
    if (account.provider === 'google' && historyReached(state.cursor, payload.target_history_id)) {
      result.already_current = true;
      continue;
    }
    try {
      await withLease(run, state, 150, async () => {
        const cursor: MailCursor = {
          kind: cursorKind(account.provider),
          value: state.cursor ?? '',
          ...(folder === undefined ? {} : { folder }),
        };
        let pageToken = state.page_token;
        while (true) {
          const set = await adapter.changesSince(ctx, cursor, pageToken);
          const metadata =
            set.needsMetadata.length === 0
              ? []
              : await fetchMetadata(ctx, adapter, set.needsMetadata);
          const messages = [...set.upserts, ...metadata];
          const inserted = await storeMessages(run, ctx, adapter, account, messages);
          if (inserted.length > 0)
            await enqueueTriage(run.rt, account, inserted, 'incremental', run.correlationId);
          if (set.labelChanges.length > 0 || set.deleted.length > 0) {
            const applied = await run.rt.store.applyMailChanges(
              account.id,
              set.labelChanges.map((c) => ({
                provider_message_id: c.providerMessageId,
                labels: c.labels,
                is_read: c.isRead,
              })),
              set.deleted,
            );
            result.deleted = Number(result.deleted) + applied.deleted;
            result.label_changes = Number(result.label_changes) + applied.label_changes;
            // Derived rows follow the mailbox (§3.13): insights of deleted / archived threads expire.
            if (applied.deleted > 0 || applied.label_changes > 0)
              await enqueueInsightRefresh(run.rt, account, 'mail', 'mail_changes');
          }
          result.upserts = Number(result.upserts) + messages.length;
          pageToken = set.pageToken;
          const now = run.rt.now().toISOString();
          if (pageToken === null) {
            await run.rt.store.updateSyncState(state.id, {
              cursor: set.nextCursor.value,
              page_token: null,
              status: 'idle',
              last_incremental_sync_at: now,
              last_success_at: now,
              consecutive_failures: 0,
              last_error_code: null,
            });
            break;
          }
          if (outOfTime(run)) {
            await run.rt.store.updateSyncState(state.id, { page_token: pageToken });
            await run.rt.enqueue({
              type: account.provider === 'microsoft' ? 'outlook_sync' : 'gmail_sync',
              idempotencyKey: `${account.provider === 'microsoft' ? `outlook_sync:${account.id}:${folder ?? 'both'}` : `gmail_sync:${account.id}`}:pending`,
              payload:
                account.provider === 'microsoft'
                  ? {
                      connected_account_id: account.id,
                      folder: folder ?? 'both',
                      trigger: payload.trigger,
                    }
                  : {
                      connected_account_id: account.id,
                      trigger: payload.trigger,
                      target_history_id: null,
                    },
              userId: account.user_id,
              accountId: account.id,
              priority: 60,
              maxAttempts: 6,
            });
            result.continued = true;
            break;
          }
        }
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'cursor_invalid') {
        const now = run.rt.now();
        await run.rt.store.updateSyncState(state.id, {
          status: 'resync_required',
          cursor_invalidated_at: now.toISOString(),
          page_token: null,
        });
        await enqueueInitialSync(run.rt, account, {
          resource: 'mail',
          phase: 'resync',
          windowStart: new Date(now.getTime() - RESYNC_DAYS * 86_400_000).toISOString(),
          // One resync per invalidated history window: a push (`provider_webhook` → `gmail_sync`)
          // and a poll that both hit the 404 on the same stale cursor share the idempotency key
          // (hashed: a Graph delta link is longer than the payload's `origin`).
          origin: `resync:${state.id}:${await sha1Hex(state.cursor ?? '')}`,
          correlationId: run.correlationId,
          ...(folder === undefined ? {} : { folder }),
        });
        result.resync = true;
        continue;
      }
      return await failJob(run, account, error, state);
    }
  }
  await recordSyncSuccess(run.rt, account);
  if (polling || account.provider === 'demo') await schedulePoll(run, account, 'mail');
  return result;
}
