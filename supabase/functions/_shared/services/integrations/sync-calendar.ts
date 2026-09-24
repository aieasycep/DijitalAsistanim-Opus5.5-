/**
 * Calendar sync (API_CONTRACTS JOB-01 calendar, JOB-04 `calendar_sync`; INTEGRATION_PLAN §3.7, §4.5,
 * §5.5, §13.2; T-4.04, T-4.08, T-4.10, T-4.12).
 *
 * - First pass: `calendarList` → `calendars` (Free: the primary only; Pro: owned / writable up to
 *   `max_calendars`; holidays and birthdays never), then a windowed full sync of every selected
 *   calendar. Calendars that disappeared at the provider are deleted with their events.
 * - Incremental: Google `syncToken`, Graph `calendarView/delta`, demo clock. An invalid cursor
 *   (Google 410, Graph 410 / `syncStateNotFound`) → a full sync whose prune removes every event the
 *   provider no longer returns inside the window (the soft wipe).
 * - `mode:'rebaseline'` (scheduler): Graph slides its calendarView window daily.
 * Cancelled occurrences keep their row with `provider_deleted_at`; non-allow-listed join URLs are
 * dropped (`rows.ts`). Accounts without a channel / subscription are polled every 10 minutes (demo 5).
 */
import {
  type CalendarCursor,
  type CalendarProvider,
  type CalendarWindow,
  type ProviderContext,
  ProviderError,
} from '@da/domain';
import type { JobResult } from '../../jobs/types.ts';
import { providerContextFor } from './context.ts';
import { enqueueInsightRefresh, enqueueWatch, type InitialSyncPayload } from './enqueue.ts';
import { eventRowOf } from './rows.ts';
import { recordSyncSuccess, togglesOf } from './status.ts';
import {
  activeAccount,
  calendarResource,
  failJob,
  hasLiveWatch,
  outOfTime,
  schedulePoll,
  type SyncRun,
  withLease,
} from './sync-common.ts';
import type { AccountRecord, CalendarRecord, SyncStateRecord } from './types.ts';

const DAY = 86_400_000;

/** The stored event window per provider (INTEGRATION_PLAN §3.7, JOB-01). */
export function calendarWindow(provider: string, now: Date): CalendarWindow {
  const t = now.getTime();
  if (provider === 'microsoft')
    return {
      start: new Date(t - 2 * DAY).toISOString(),
      end: new Date(t + 60 * DAY).toISOString(),
    };
  if (provider === 'demo')
    return {
      start: new Date(t - 7 * DAY).toISOString(),
      end: new Date(t + 30 * DAY).toISOString(),
    };
  return {
    start: new Date(t - 30 * DAY).toISOString(),
    end: new Date(t + 365 * DAY).toISOString(),
  };
}

function cursorKind(provider: string): CalendarCursor['kind'] {
  return provider === 'microsoft'
    ? 'graph_calendar_view_delta'
    : provider === 'demo'
      ? 'demo_clock'
      : 'gcal_sync_token';
}

function calendarAdapter(run: SyncRun, account: AccountRecord): CalendarProvider {
  const adapters = run.rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  if (adapters.calendar === undefined)
    throw new ProviderError('external_credential_required', null, null, 'calendar_adapter_missing');
  return adapters.calendar;
}

export function calendarPaused(account: AccountRecord): boolean {
  return (
    !account.capabilities_granted.includes('calendar_read') || !togglesOf(account).calendar_read
  );
}

interface CalendarCounts {
  upserted: number;
  deleted: number;
}

async function stateFor(
  run: SyncRun,
  account: AccountRecord,
  calendar: CalendarRecord,
): Promise<SyncStateRecord> {
  return await run.rt.store.ensureSyncState({
    userId: account.user_id,
    accountId: account.id,
    resource: calendarResource(account.provider),
    resourceKey: calendar.id,
    calendarId: calendar.id,
  });
}

/** Full windowed sync of one calendar, then prune what the provider no longer returns. */
async function fullCalendarSync(
  run: SyncRun,
  ctx: ProviderContext,
  adapter: CalendarProvider,
  account: AccountRecord,
  calendar: CalendarRecord,
  state: SyncStateRecord,
  timeZone: string,
  counts: CalendarCounts,
): Promise<void> {
  const now = run.rt.now();
  const window = calendarWindow(account.provider, now);
  const since = now.toISOString();
  const origin = account.provider === 'demo' ? 'demo' : 'provider_sync';
  let pageToken: string | null = null;
  let next: CalendarCursor | null = null;
  do {
    const set = await adapter.fullSync(ctx, calendar.provider_calendar_id, window, pageToken);
    const out = await run.rt.store.upsertEvents(
      account.id,
      calendar.id,
      set.upserts.map((e) => eventRowOf(e, timeZone)),
      origin,
    );
    counts.upserted += out.upserted;
    if (set.deleted.length > 0)
      counts.deleted += await run.rt.store.markEventsDeleted(calendar.id, set.deleted);
    pageToken = set.pageToken;
    next = set.nextCursor;
  } while (pageToken !== null);
  counts.deleted += await run.rt.store.pruneEvents(calendar.id, since, window.start, window.end);
  const at = run.rt.now().toISOString();
  await run.rt.store.updateSyncState(state.id, {
    cursor: next?.value ?? null,
    window_start: window.start,
    window_end: window.end,
    status: 'idle',
    page_token: null,
    last_full_sync_at: at,
    last_success_at: at,
    consecutive_failures: 0,
    last_error_code: null,
    cursor_invalidated_at: null,
    rebaseline_due_at:
      account.provider === 'microsoft' ? new Date(now.getTime() + DAY).toISOString() : null,
  });
}

async function incrementalCalendarSync(
  run: SyncRun,
  ctx: ProviderContext,
  adapter: CalendarProvider,
  account: AccountRecord,
  calendar: CalendarRecord,
  state: SyncStateRecord,
  timeZone: string,
  counts: CalendarCounts,
): Promise<void> {
  if (state.cursor === null) {
    await fullCalendarSync(run, ctx, adapter, account, calendar, state, timeZone, counts);
    return;
  }
  const cursor: CalendarCursor = {
    kind: cursorKind(account.provider),
    value: state.cursor,
    ...(state.window_start !== null && state.window_end !== null
      ? { window: { start: state.window_start, end: state.window_end } }
      : {}),
  };
  const origin = account.provider === 'demo' ? 'demo' : 'provider_sync';
  let pageToken: string | null = null;
  let next: CalendarCursor | null = null;
  try {
    do {
      const set = await adapter.changesSince(ctx, calendar.provider_calendar_id, cursor, pageToken);
      const out = await run.rt.store.upsertEvents(
        account.id,
        calendar.id,
        set.upserts.map((e) => eventRowOf(e, timeZone)),
        origin,
      );
      counts.upserted += out.upserted;
      if (set.deleted.length > 0)
        counts.deleted += await run.rt.store.markEventsDeleted(calendar.id, set.deleted);
      pageToken = set.pageToken;
      next = set.nextCursor;
    } while (pageToken !== null);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'cursor_invalid') {
      await run.rt.store.updateSyncState(state.id, {
        cursor: null,
        cursor_invalidated_at: run.rt.now().toISOString(),
        status: 'resync_required',
      });
      await fullCalendarSync(
        run,
        ctx,
        adapter,
        account,
        calendar,
        { ...state, cursor: null },
        timeZone,
        counts,
      );
      return;
    }
    throw error;
  }
  const at = run.rt.now().toISOString();
  await run.rt.store.updateSyncState(state.id, {
    cursor: next?.value ?? state.cursor,
    status: 'idle',
    last_incremental_sync_at: at,
    last_success_at: at,
    consecutive_failures: 0,
    last_error_code: null,
  });
}

async function syncCalendars(
  run: SyncRun,
  account: AccountRecord,
  calendars: readonly CalendarRecord[],
  mode: 'full' | 'incremental',
): Promise<JobResult> {
  const counts: CalendarCounts = { upserted: 0, deleted: 0 };
  const adapter = calendarAdapter(run, account);
  const ctx = await providerContextFor(run.rt, account, {
    owner: run.owner,
    correlationId: run.correlationId,
    log: run.log,
    ...(run.signal === undefined ? {} : { signal: run.signal }),
  });
  const timeZone = await run.rt.store.userTimeZone(account.user_id);
  let polling = false;
  const remaining: string[] = [];
  for (const calendar of calendars) {
    if (outOfTime(run)) {
      remaining.push(calendar.id);
      continue;
    }
    const state = await stateFor(run, account, calendar);
    if (!hasLiveWatch(state, run.rt.now())) polling = true;
    try {
      await withLease(run, state, 150, async () => {
        if (mode === 'full')
          await fullCalendarSync(run, ctx, adapter, account, calendar, state, timeZone, counts);
        else
          await incrementalCalendarSync(
            run,
            ctx,
            adapter,
            account,
            calendar,
            state,
            timeZone,
            counts,
          );
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') {
        await run.rt.store.deleteCalendars([calendar.id]);
        continue;
      }
      return await failJob(run, account, error, state);
    }
  }
  for (const calendarId of remaining) {
    await run.rt.enqueue({
      type: 'calendar_sync',
      idempotencyKey: `calendar_sync:${account.id}:${calendarId}:pending`,
      payload: { connected_account_id: account.id, calendar_id: calendarId, trigger: 'reconcile' },
      userId: account.user_id,
      accountId: account.id,
      priority: 60,
      maxAttempts: 6,
    });
  }
  if (counts.upserted + counts.deleted > 0)
    await enqueueInsightRefresh(run.rt, account, 'calendar', 'calendar_sync');
  if (polling && calendars.length > 0) await schedulePoll(run, account, 'calendar');
  return {
    calendars: calendars.length,
    upserted: counts.upserted,
    deleted: counts.deleted,
    continued: remaining.length,
  };
}

/** JOB-01, resource `calendar`. */
export async function runInitialCalendar(
  run: SyncRun,
  payload: InitialSyncPayload,
): Promise<JobResult> {
  const found = await activeAccount(run, payload.connected_account_id);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  if (calendarPaused(account)) return { skipped: 'paused' };
  try {
    const adapter = calendarAdapter(run, account);
    const ctx = await providerContextFor(run.rt, account, {
      owner: run.owner,
      correlationId: run.correlationId,
      log: run.log,
      ...(run.signal === undefined ? {} : { signal: run.signal }),
    });
    const listed = await adapter.listCalendars(ctx);
    const upserted = await run.rt.store.upsertCalendars(
      account.id,
      listed
        .filter((c) => !c.deleted)
        .map((c) => ({
          provider_calendar_id: c.providerCalendarId,
          name: c.name.slice(0, 200),
          color: c.color,
          time_zone: c.timeZone,
          access_role: c.accessRole,
          is_primary: c.isPrimary,
          can_write: c.canWrite,
          kind: c.kind,
        })),
    );
    if (upserted.missing.length > 0) await run.rt.store.deleteCalendars(upserted.missing);
    const selected = upserted.calendars.filter((c) => c.selected);
    const result = await syncCalendars(run, account, selected, 'full');
    const fresh = (await run.rt.store.getAccount(account.id)) ?? account;
    await recordSyncSuccess(run.rt, fresh, { finishedFirstPass: payload.phase === 'first_pass' });
    if (account.provider !== 'demo') {
      for (const calendar of selected) {
        await enqueueWatch(run.rt, account, {
          resource: account.provider === 'microsoft' ? 'graph_calendar' : 'gcal_channel',
          calendarId: calendar.id,
          mode: 'create',
          correlationId: run.correlationId,
        });
      }
    }
    await enqueueInsightRefresh(run.rt, account, 'calendar', 'initial_sync');
    return { ...(result ?? {}), listed: listed.length };
  } catch (error) {
    return await failJob(run, account, error);
  }
}

export interface CalendarSyncPayload {
  readonly connected_account_id?: string;
  readonly calendar_id?: string | null;
  readonly trigger?: 'push' | 'poll' | 'manual' | 'reconcile' | 'post_write';
  readonly sync_state_id?: string;
  readonly mode?: 'rebaseline';
}

/** JOB-04 (and the scheduler's Graph re-baseline). */
export async function runCalendarSync(
  run: SyncRun,
  payload: CalendarSyncPayload,
): Promise<JobResult> {
  let accountId = payload.connected_account_id ?? null;
  let calendarId = payload.calendar_id ?? null;
  if (payload.sync_state_id !== undefined) {
    const state = await run.rt.store.getSyncState(payload.sync_state_id);
    if (state === null) return { skipped: 'sync_state_gone' };
    accountId = state.connected_account_id;
    calendarId = state.calendar_id;
  }
  if (accountId === null) return { skipped: 'no_account' };
  const found = await activeAccount(run, accountId);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  if (calendarPaused(account)) return { skipped: 'paused' };
  if (await run.rt.store.pausedByPlan(account.id)) return { skipped: 'paused' };
  const all = await run.rt.store.listCalendars(account.id);
  const targets = all.filter((c) => c.selected && (calendarId === null || c.id === calendarId));
  if (targets.length === 0) return { skipped: 'no_selected_calendar' };
  try {
    return await syncCalendars(
      run,
      account,
      targets,
      payload.mode === 'rebaseline' ? 'full' : 'incremental',
    );
  } catch (error) {
    return await failJob(run, account, error);
  }
}
