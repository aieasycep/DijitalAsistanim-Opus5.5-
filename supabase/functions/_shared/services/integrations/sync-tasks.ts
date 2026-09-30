/**
 * Tasks sync (API_CONTRACTS JOB-01 tasks, JOB-05 `tasks_sync`; INTEGRATION_PLAN §4.6, §5.6; T-4.05,
 * T-4.08, T-4.10). Google Tasks has no push: `tasks.list?updatedMin=` per list every 15 minutes
 * (scheduler) and on foreground; To Do uses per-list delta. Deleted provider tasks are dismissed;
 * Google's date-only `due` stays a date.
 */
import {
  type ProviderContext,
  ProviderError,
  type TaskCursor,
  type TaskProvider,
} from '@da/domain';
import type { JobResult } from '../../jobs/types.ts';
import { providerContextFor } from './context.ts';
import { enqueueInsightRefresh, type InitialSyncPayload } from './enqueue.ts';
import { deletedTaskRow, taskRowOf } from './rows.ts';
import { recordSyncSuccess, togglesOf } from './status.ts';
import {
  activeAccount,
  failJob,
  outOfTime,
  type SyncRun,
  tasksResource,
  withLease,
} from './sync-common.ts';
import type { AccountRecord } from './types.ts';

function cursorKind(provider: string): TaskCursor['kind'] {
  return provider === 'microsoft'
    ? 'graph_todo_delta'
    : provider === 'demo'
      ? 'demo_clock'
      : 'gtasks_updated_min';
}

function tasksAdapter(run: SyncRun, account: AccountRecord): TaskProvider {
  const adapters = run.rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  if (adapters.tasks === undefined)
    throw new ProviderError('external_credential_required', null, null, 'tasks_adapter_missing');
  return adapters.tasks;
}

export function tasksPaused(account: AccountRecord): boolean {
  return !account.capabilities_granted.includes('tasks_read') || !togglesOf(account).tasks_read;
}

async function syncLists(
  run: SyncRun,
  account: AccountRecord,
  ctx: ProviderContext,
  adapter: TaskProvider,
): Promise<{ upserted: number; dismissed: number; lists: number; continued: boolean }> {
  const lists = (await adapter.listTaskLists(ctx)).filter((l) => !l.deleted);
  const out = { upserted: 0, dismissed: 0, lists: lists.length, continued: false };
  for (const list of lists) {
    if (outOfTime(run)) {
      out.continued = true;
      break;
    }
    const state = await run.rt.store.ensureSyncState({
      userId: account.user_id,
      accountId: account.id,
      resource: tasksResource(account.provider),
      resourceKey: list.providerListId,
    });
    await withLease(run, state, 120, async () => {
      let cursor: TaskCursor | null =
        state.cursor === null ? null : { kind: cursorKind(account.provider), value: state.cursor };
      let pageToken: string | null = null;
      let next: TaskCursor | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          do {
            const set = await adapter.changesSince(ctx, list.providerListId, cursor, pageToken);
            const rows = [
              ...set.upserts.map(taskRowOf),
              ...set.deleted.map((id) => deletedTaskRow(id, list.providerListId)),
            ];
            if (rows.length > 0) {
              const result = await run.rt.store.upsertTasks(account.id, rows);
              out.upserted += result.upserted;
              out.dismissed += set.deleted.length + set.upserts.filter((t) => t.deleted).length;
            }
            pageToken = set.pageToken;
            next = set.nextCursor;
          } while (pageToken !== null);
          break;
        } catch (error) {
          if (attempt === 0 && error instanceof ProviderError && error.code === 'cursor_invalid') {
            cursor = null;
            pageToken = null;
            continue;
          }
          throw error;
        }
      }
      const at = run.rt.now().toISOString();
      await run.rt.store.updateSyncState(state.id, {
        cursor: (next as TaskCursor | null)?.value ?? state.cursor,
        status: 'idle',
        last_success_at: at,
        last_incremental_sync_at: at,
        consecutive_failures: 0,
        last_error_code: null,
      });
    });
  }
  return out;
}

async function run(runCtx: SyncRun, accountId: string, first: boolean): Promise<JobResult> {
  const found = await activeAccount(runCtx, accountId);
  if ('skipped' in found) return { skipped: found.skipped };
  const account = found.account;
  if (tasksPaused(account)) return { skipped: 'paused' };
  if (await runCtx.rt.store.pausedByPlan(account.id)) return { skipped: 'paused' };
  try {
    const adapter = tasksAdapter(runCtx, account);
    const ctx = await providerContextFor(runCtx.rt, account, {
      owner: runCtx.owner,
      correlationId: runCtx.correlationId,
      log: runCtx.log,
      ...(runCtx.signal === undefined ? {} : { signal: runCtx.signal }),
    });
    const result = await syncLists(runCtx, account, ctx, adapter);
    if (result.continued) {
      await runCtx.rt.enqueue({
        type: 'tasks_sync',
        idempotencyKey: `tasks_sync:${account.id}:pending`,
        payload: { connected_account_id: account.id, trigger: 'poll' },
        userId: account.user_id,
        accountId: account.id,
        priority: 100,
        maxAttempts: 5,
      });
    }
    await recordSyncSuccess(runCtx.rt, account, { finishedFirstPass: first });
    if (result.upserted + result.dismissed > 0)
      await enqueueInsightRefresh(runCtx.rt, account, 'tasks', 'tasks_sync');
    return { ...result };
  } catch (error) {
    return await failJob(runCtx, account, error);
  }
}

/** JOB-01, resource `tasks`. */
export async function runInitialTasks(
  runCtx: SyncRun,
  payload: InitialSyncPayload,
): Promise<JobResult> {
  return await run(runCtx, payload.connected_account_id, payload.phase === 'first_pass');
}

export interface TasksSyncPayload {
  readonly connected_account_id?: string;
  /** The scheduler's poll uses `account_id`. */
  readonly account_id?: string;
  readonly trigger: 'poll' | 'manual' | 'post_write';
}

/** JOB-05. */
export async function runTasksSync(runCtx: SyncRun, payload: TasksSyncPayload): Promise<JobResult> {
  const accountId = payload.connected_account_id ?? payload.account_id;
  if (accountId === undefined) return { skipped: 'no_account' };
  return await run(runCtx, accountId, false);
}
