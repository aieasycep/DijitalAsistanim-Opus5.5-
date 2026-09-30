/**
 * Google Tasks `TaskProvider` (INTEGRATION_PLAN §4.6, §3.12; API_CONTRACTS JOB-05; T-4.06):
 * - lists (`tasklists.list`), then per list `tasks.list` with `showDeleted/showHidden/showCompleted`
 *   and `updatedMin = cursor − 60 s`; no push and no sync token exist, so the cursor is the sync start
 *   time; the first run keeps open tasks and those completed in the last 30 days;
 * - due dates are date-only ("Only date information is recorded");
 * - writes append the visible text marker `[DA:…]` to the notes (no client id is supported) and the
 *   probe searches notes of tasks updated since the attempt started.
 */
import {
  findTextMarker,
  type IdempotencyMarker,
  type NormalizedTask,
  type NormalizedTaskList,
  type ProviderContext,
  type TaskChangeSet,
  type TaskCursor,
  type TaskProvider,
  type TaskWriteSpec,
  type WriteOutcome,
} from '@da/domain';
import { type AdapterHttp, authorizedJson, excerptOrNull, isoOrNull, jsonBody } from '../common.ts';
import type { GoogleEndpoints } from './config.ts';

export interface GoogleTasksConfig {
  readonly endpoints: GoogleEndpoints;
  readonly http: AdapterHttp;
}

interface GTask {
  readonly id: string;
  readonly title?: string;
  readonly notes?: string;
  readonly status?: string;
  readonly due?: string;
  readonly completed?: string;
  readonly updated?: string;
  readonly deleted?: boolean;
  readonly hidden?: boolean;
  readonly webViewLink?: string;
}

const NOTES_LIMIT = 8192;

export function normalizeGoogleTask(task: GTask, providerListId: string): NormalizedTask {
  return {
    providerTaskId: task.id,
    providerListId,
    title: [...(task.title ?? '').trim()].slice(0, 1024).join(''),
    notesSnippet: excerptOrNull(task.notes, 500),
    status: task.status === 'completed' ? 'completed' : 'open',
    due: task.due === undefined ? null : { date: task.due.slice(0, 10) },
    completedAt: isoOrNull(task.completed ?? null),
    importance: null,
    updatedAt: isoOrNull(task.updated ?? null),
    daMarker: findTextMarker(task.notes),
    deleted: task.deleted === true,
  };
}

export class GoogleTasksAdapter implements TaskProvider {
  readonly provider = 'google' as const;
  constructor(private readonly config: GoogleTasksConfig) {}

  private url(path: string, query: Record<string, string | null | undefined> = {}): string {
    const url = new URL(`${this.config.endpoints.tasks}/tasks/v1${path}`);
    for (const [key, value] of Object.entries(query))
      if (value !== null && value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }

  private get<T>(ctx: ProviderContext, url: string, interactive = false): Promise<T> {
    return authorizedJson<T>(ctx, this.config.http, {
      url,
      quota: {
        bucket: 'gtasks_project_requests_day',
        units: 1,
        priority: interactive ? 'interactive' : 'sync',
      },
    });
  }

  async listTaskLists(ctx: ProviderContext): Promise<NormalizedTaskList[]> {
    const res = await this.get<{ items?: { id: string; title?: string }[] }>(
      ctx,
      this.url('/users/@me/lists', { maxResults: '100' }),
    );
    return (res.items ?? []).map((list, index) => ({
      providerListId: list.id,
      name: (list.title ?? '').slice(0, 200),
      isDefault: index === 0,
      deleted: false,
    }));
  }

  async changesSince(
    ctx: ProviderContext,
    providerListId: string,
    cursor: TaskCursor | null,
    pageToken?: string | null,
  ): Promise<TaskChangeSet> {
    const now = ctx.clock.now();
    const updatedMin =
      cursor === null ? null : new Date(Date.parse(cursor.value) - 60_000).toISOString();
    const res = await this.get<{ items?: GTask[]; nextPageToken?: string }>(
      ctx,
      this.url(`/lists/${encodeURIComponent(providerListId)}/tasks`, {
        showDeleted: 'true',
        showHidden: 'true',
        showCompleted: 'true',
        maxResults: '100',
        updatedMin,
        pageToken: pageToken ?? null,
      }),
    );
    const recentCutoff = now.getTime() - 30 * 86_400_000;
    const upserts: NormalizedTask[] = [];
    const deleted: string[] = [];
    for (const item of res.items ?? []) {
      if (item.deleted === true) {
        deleted.push(item.id);
        continue;
      }
      if (
        cursor === null &&
        item.status === 'completed' &&
        Date.parse(item.completed ?? '') < recentCutoff
      )
        continue;
      upserts.push(normalizeGoogleTask(item, providerListId));
    }
    return {
      upserts,
      deleted,
      nextCursor: { kind: 'gtasks_updated_min', value: now.toISOString() },
      pageToken: res.nextPageToken ?? null,
    };
  }

  async createTask(ctx: ProviderContext, spec: TaskWriteSpec): Promise<WriteOutcome> {
    const marker = spec.marker.textMarker;
    const base = (spec.notes ?? '').slice(0, NOTES_LIMIT - marker.length - 2);
    const notes = base === '' ? marker : `${base}\n\n${marker}`;
    const due =
      spec.due === null
        ? undefined
        : 'date' in spec.due
          ? spec.due.date
          : spec.due.dateTime.slice(0, 10);
    const created = await authorizedJson<{ id: string; webViewLink?: string }>(
      ctx,
      this.config.http,
      {
        url: this.url(`/lists/${encodeURIComponent(spec.providerListId)}/tasks`),
        method: 'POST',
        ...jsonBody({
          title: [...spec.title].slice(0, 1024).join(''),
          notes,
          ...(due === undefined ? {} : { due: `${due}T00:00:00.000Z` }),
        }),
        quota: { bucket: 'gtasks_project_requests_day', units: 1, priority: 'interactive' },
        idempotent: false,
      },
    );
    return { kind: 'created', providerId: created.id, webLink: created.webViewLink ?? null };
  }

  async findTaskByMarker(
    ctx: ProviderContext,
    providerListId: string,
    marker: IdempotencyMarker,
    createdAfter: string,
  ): Promise<WriteOutcome | null> {
    let pageToken: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res: { items?: GTask[]; nextPageToken?: string } = await this.get(
        ctx,
        this.url(`/lists/${encodeURIComponent(providerListId)}/tasks`, {
          updatedMin: new Date(Date.parse(createdAfter) - 5 * 60_000).toISOString(),
          showHidden: 'true',
          showCompleted: 'true',
          maxResults: '100',
          pageToken,
        }),
        true,
      );
      const hit = (res.items ?? []).find(
        (t) => t.deleted !== true && findTextMarker(t.notes) === marker.textMarker,
      );
      if (hit !== undefined)
        return { kind: 'already_exists', providerId: hit.id, webLink: hit.webViewLink ?? null };
      pageToken = res.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return null;
  }
}
