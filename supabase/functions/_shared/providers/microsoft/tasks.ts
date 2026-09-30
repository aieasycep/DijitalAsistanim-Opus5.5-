/**
 * Microsoft To Do `TaskProvider` (INTEGRATION_PLAN §5.6, §3.12; API_CONTRACTS JOB-05; T-4.08):
 * - lists (`/me/todo/lists`, `wellknownListName=defaultList` is the default);
 * - per list `tasks/delta`, polled every 15 minutes (subscriptions are not used: `todoTask`
 *   lifetime < 3 days); `@removed` → deleted; 410 → `cursor_invalid`;
 * - status `completed` → completed, everything else open; `dueDateTime` keeps its time zone;
 * - writes carry `linkedResources[{externalId: approvalId, webUrl: deep link}]`, probed by
 *   `createdDateTime` filter + `$expand=linkedResources`.
 */
import {
  type IdempotencyMarker,
  type NormalizedTask,
  type NormalizedTaskList,
  type ProviderContext,
  ProviderError,
  type TaskChangeSet,
  type TaskCursor,
  type TaskProvider,
  type TaskWriteSpec,
  type WriteOutcome,
} from '@da/domain';
import { excerptOrNull, isoOrNull } from '../common.ts';
import type { GraphClient } from './graph.ts';

interface TodoTask {
  readonly id: string;
  readonly '@removed'?: { reason?: string };
  readonly title?: string;
  readonly body?: { content?: string };
  readonly status?: string;
  readonly importance?: string;
  readonly dueDateTime?: { dateTime?: string; timeZone?: string };
  readonly completedDateTime?: { dateTime?: string; timeZone?: string };
  readonly lastModifiedDateTime?: string;
  readonly linkedResources?: { externalId?: string; webUrl?: string }[];
}

function utc(value: { dateTime?: string; timeZone?: string } | undefined): string | null {
  if (value?.dateTime === undefined) return null;
  const hasOffset = /[zZ]|[+-]\d\d:?\d\d$/.test(value.dateTime);
  return isoOrNull(hasOffset ? value.dateTime : `${value.dateTime}Z`);
}

export function normalizeTodoTask(task: TodoTask, providerListId: string): NormalizedTask {
  const importance = task.importance?.toLowerCase();
  const due = task.dueDateTime;
  const dueDateTime = utc(due);
  return {
    providerTaskId: task.id,
    providerListId,
    title: [...(task.title ?? '').trim()].slice(0, 1024).join(''),
    notesSnippet: excerptOrNull(task.body?.content, 500),
    status: task.status === 'completed' ? 'completed' : 'open',
    due:
      dueDateTime === null
        ? null
        : /T00:00:00(\.0+)?$/.test(due?.dateTime ?? '')
          ? { date: dueDateTime.slice(0, 10) }
          : { dateTime: dueDateTime, timeZone: due?.timeZone ?? 'UTC' },
    completedAt: utc(task.completedDateTime),
    importance:
      importance === 'low' || importance === 'normal' || importance === 'high' ? importance : null,
    updatedAt: isoOrNull(task.lastModifiedDateTime ?? null),
    daMarker: task.linkedResources?.find((l) => l.externalId !== undefined)?.externalId ?? null,
    deleted: task['@removed'] !== undefined,
  };
}

export class TodoAdapter implements TaskProvider {
  readonly provider = 'microsoft' as const;
  constructor(private readonly graph: GraphClient) {}

  async listTaskLists(ctx: ProviderContext): Promise<NormalizedTaskList[]> {
    const res = await this.graph.json<{
      value?: { id: string; displayName?: string; wellknownListName?: string }[];
    }>(ctx, '/me/todo/lists');
    return (res.value ?? []).map((list) => ({
      providerListId: list.id,
      name: (list.displayName ?? '').slice(0, 200),
      isDefault: list.wellknownListName === 'defaultList',
      deleted: false,
    }));
  }

  async changesSince(
    ctx: ProviderContext,
    providerListId: string,
    cursor: TaskCursor | null,
    pageToken?: string | null,
  ): Promise<TaskChangeSet> {
    const url =
      pageToken ??
      cursor?.value ??
      `/me/todo/lists/${encodeURIComponent(providerListId)}/tasks/delta`;
    let res: { value?: TodoTask[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };
    try {
      res = await this.graph.json(ctx, url);
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.httpStatus === 410 || /syncStateNotFound/i.test(error.providerReason ?? ''))
      ) {
        throw new ProviderError('cursor_invalid', 410, null, 'delta_expired');
      }
      throw error;
    }
    const upserts: NormalizedTask[] = [];
    const deleted: string[] = [];
    for (const task of res.value ?? []) {
      if (task['@removed'] !== undefined) deleted.push(task.id);
      else upserts.push(normalizeTodoTask(task, providerListId));
    }
    return {
      upserts,
      deleted,
      nextCursor: {
        kind: 'graph_todo_delta',
        value: res['@odata.deltaLink'] ?? cursor?.value ?? url,
      },
      pageToken: res['@odata.nextLink'] ?? null,
    };
  }

  async createTask(ctx: ProviderContext, spec: TaskWriteSpec): Promise<WriteOutcome> {
    const due =
      spec.due === null
        ? undefined
        : 'date' in spec.due
          ? { dateTime: `${spec.due.date}T00:00:00`, timeZone: 'UTC' }
          : { dateTime: spec.due.dateTime.replace(/Z$/, ''), timeZone: 'UTC' };
    const created = await this.graph.json<{ id: string }>(
      ctx,
      `/me/todo/lists/${encodeURIComponent(spec.providerListId)}/tasks`,
      {
        method: 'POST',
        priority: 'interactive',
        idempotent: false,
        body: {
          title: spec.title,
          ...(spec.notes === null ? {} : { body: { content: spec.notes, contentType: 'text' } }),
          ...(due === undefined ? {} : { dueDateTime: due }),
          importance: spec.importance,
          linkedResources: [
            {
              webUrl: spec.marker.deepLinkUrl,
              applicationName: 'Dijital Asistan',
              externalId: spec.marker.approvalId,
              displayName: 'Dijital Asistan onayı',
            },
          ],
        },
      },
    );
    return { kind: 'created', providerId: created.id, webLink: null };
  }

  async findTaskByMarker(
    ctx: ProviderContext,
    providerListId: string,
    marker: IdempotencyMarker,
    createdAfter: string,
  ): Promise<WriteOutcome | null> {
    const since = new Date(Date.parse(createdAfter) - 5 * 60_000).toISOString();
    let url: string | null =
      `/me/todo/lists/${encodeURIComponent(providerListId)}/tasks?$filter=${encodeURIComponent(`createdDateTime ge ${since}`)}` +
      '&$expand=linkedResources&$top=50';
    for (let page = 0; page < 5 && url !== null; page++) {
      const res: { value?: TodoTask[]; '@odata.nextLink'?: string } = await this.graph.json(
        ctx,
        url,
        { priority: 'interactive' },
      );
      const hit = (res.value ?? []).find((t) =>
        (t.linkedResources ?? []).some((l) => l.externalId === marker.approvalId),
      );
      if (hit !== undefined) return { kind: 'already_exists', providerId: hit.id, webLink: null };
      url = res['@odata.nextLink'] ?? null;
    }
    return null;
  }
}
