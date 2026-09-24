/**
 * `task_create` execution (IMPLEMENTATION_PLAN T-6.04; API_CONTRACTS §6.4):
 * - Google Tasks: `tasks.insert` with the visible notes marker; the returned id is stored and a
 *   retry searches recent tasks for the marker first. Due dates are date-only.
 * - Microsoft To Do: `linkedResources` marker (`externalId = approval id`), same probe on retry.
 * - In-app: a `tasks` row with key `approval:{id}` (a retry finds the existing row).
 * Apple Reminders targets run on the device (T-6.05).
 */
import type { TaskWriteSpec, WriteOutcome } from '@da/domain';
import { localDate } from '@da/domain';
import type { Json } from '../../../jobs/types.ts';
import { insightRefresh, openDestination, outcomeResult, tasksSync, toFailure } from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

export const TASK_PROBE_WINDOW_MS = 5 * 60_000;

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

export async function executeTaskCreate(env: ExecEnv): Promise<ExecOutcome> {
  const approval = env.approval;
  const payload = approval.payload;
  if (payload.action_type !== 'task_create' || payload.target.kind === 'device') {
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'not_a_server_target');
  }
  if (payload.target.kind === 'in_app') {
    const due = payload.due;
    const row: Record<string, Json> = {
      user_id: approval.user_id,
      connected_account_id: null,
      provider: null,
      title: clip(payload.title, 500),
      notes_excerpt: payload.notes === undefined ? null : clip(payload.notes, 1000),
      due_date:
        due === undefined
          ? null
          : due.kind === 'date'
            ? due.date
            : localDate(due.at, due.time_zone),
      due_at: due !== undefined && due.kind === 'date_time' ? new Date(due.at).toISOString() : null,
      status: 'open',
      origin: 'approval_write',
      approval_action_id: approval.id,
      idempotency_key: `approval:${approval.id}`,
      source_type: approval.source_type,
      source_id: approval.source_id,
      source_provider: approval.source_provider,
      source_timestamp: approval.source_timestamp,
      confidence: approval.confidence,
    };
    const task = await env.repo.insertTask(row);
    return {
      providerRef: `task:${task.id}`,
      result: { target: 'in_app', task_id: task.id, already_existed: !task.created },
      followUps: [insightRefresh(approval.user_id, 'tasks')],
    };
  }

  const target = payload.target;
  const { session, account } = await openDestination(
    env,
    target.connected_account_id,
    'tasks_write',
  );
  const tasksApi = session.adapters.tasks;
  if (tasksApi === undefined)
    throw new ExecutionFailure('FEATURE_DISABLED', false, null, 'tasks_adapter');
  const due = payload.due;
  const spec: TaskWriteSpec = {
    providerListId: target.task_list_id,
    title: payload.title,
    notes: payload.notes ?? null,
    due:
      due === undefined
        ? null
        : due.kind === 'date'
          ? { date: due.date }
          : { dateTime: new Date(due.at).toISOString(), timeZone: due.time_zone },
    importance: payload.importance ?? 'normal',
    marker: env.marker,
  };
  let outcome: WriteOutcome | null = null;
  try {
    if (env.probeFirst) {
      const createdAfter = new Date(
        Date.parse(approval.approved_at ?? approval.created_at) - TASK_PROBE_WINDOW_MS,
      ).toISOString();
      outcome = await tasksApi.findTaskByMarker(
        session.ctx,
        target.task_list_id,
        env.marker,
        createdAfter,
      );
    }
    if (outcome === null) outcome = await tasksApi.createTask(session.ctx, spec);
  } catch (error) {
    throw toFailure(error);
  }
  return {
    providerRef: outcome.providerId,
    result: outcomeResult(outcome, { target: 'provider', provider: account.provider }),
    followUps: [tasksSync(account), insightRefresh(approval.user_id, 'tasks')],
  };
}
