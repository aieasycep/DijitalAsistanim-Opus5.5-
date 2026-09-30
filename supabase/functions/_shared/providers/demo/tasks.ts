/**
 * Demo `TaskProvider` (INTEGRATION_PLAN §13.3): "Görevlerim" (Google flavour) / "Görevler" (Microsoft
 * flavour) with the fixture tasks of the local day plus the tasks created through approvals
 * (`private.demo_fixture_state`, resource `tasks`). Tasks of earlier days that the current day no
 * longer materialises are reported as deleted.
 */
import {
  addDaysToLocalDate,
  type IdempotencyMarker,
  localDate,
  localDateDiffDays,
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
import { demoDataset } from './fixtures/index.ts';
import {
  type DemoAdapterDeps,
  type DemoTaskWrite,
  demoWrites,
  flavorOf,
  recordDemoWrite,
} from './writes.ts';

const RETIRE_DAYS = 7;

function createdTask(write: DemoTaskWrite): NormalizedTask {
  const notes = [write.notes, write.marker]
    .filter((v): v is string => v !== null && v !== '')
    .join('\n\n');
  return {
    providerTaskId: write.id,
    providerListId: write.listId,
    title: write.title,
    notesSnippet: notes === '' ? null : notes.slice(0, 500),
    status: 'open',
    due: write.due,
    completedAt: null,
    importance: write.importance,
    updatedAt: write.createdAt,
    daMarker: write.marker,
    deleted: false,
  };
}

export class DemoTaskAdapter implements TaskProvider {
  readonly provider = 'demo' as const;
  constructor(private readonly deps: DemoAdapterDeps) {}

  private async current(ctx: ProviderContext): Promise<{
    lists: NormalizedTaskList[];
    tasks: NormalizedTask[];
    anchor: string;
    timeZone: string;
  }> {
    const timeZone = await this.deps.timeZone(ctx.account.userId);
    const dataset = demoDataset({ flavor: flavorOf(ctx), timeZone, now: ctx.clock.now() });
    const created = Object.values(await demoWrites(this.deps, ctx, 'tasks'))
      .filter((w): w is DemoTaskWrite => w.kind === 'task_create')
      .map(createdTask);
    return {
      lists: [...dataset.taskLists],
      tasks: [...dataset.tasks, ...created],
      anchor: dataset.anchor,
      timeZone,
    };
  }

  async listTaskLists(ctx: ProviderContext): Promise<NormalizedTaskList[]> {
    return (await this.current(ctx)).lists;
  }

  async changesSince(
    ctx: ProviderContext,
    providerListId: string,
    cursor: TaskCursor | null,
  ): Promise<TaskChangeSet> {
    if (
      cursor !== null &&
      (cursor.kind !== 'demo_clock' || Number.isNaN(Date.parse(cursor.value)))
    ) {
      throw new ProviderError('cursor_invalid', 410, null, 'demo_cursor_invalid');
    }
    const state = await this.current(ctx);
    if (!state.lists.some((l) => l.providerListId === providerListId)) {
      throw new ProviderError('not_found', 404, null, 'demo_list_missing');
    }
    const now = ctx.clock.now();
    const upserts = state.tasks.filter((t) => t.providerListId === providerListId);
    const present = new Set(upserts.map((t) => t.providerTaskId));
    const deleted = new Set<string>();
    if (cursor !== null) {
      const gap = Math.min(
        RETIRE_DAYS,
        Math.max(
          0,
          localDateDiffDays(localDate(new Date(cursor.value), state.timeZone), state.anchor),
        ),
      );
      for (let back = 1; back <= gap; back++) {
        const earlier = demoDataset({
          flavor: flavorOf(ctx),
          timeZone: state.timeZone,
          now,
          anchor: addDaysToLocalDate(state.anchor, -back),
        });
        for (const t of earlier.tasks)
          if (!present.has(t.providerTaskId)) deleted.add(t.providerTaskId);
      }
    }
    await this.deps.store.demoSetClock(ctx.account.connectedAccountId, 'tasks', now.toISOString());
    return {
      upserts,
      deleted: [...deleted].sort(),
      nextCursor: { kind: 'demo_clock', value: now.toISOString() },
      pageToken: null,
    };
  }

  async createTask(ctx: ProviderContext, spec: TaskWriteSpec): Promise<WriteOutcome> {
    const state = await this.current(ctx);
    if (!state.lists.some((l) => l.providerListId === spec.providerListId)) {
      throw new ProviderError('not_found', 404, null, 'demo_list_missing');
    }
    const write: DemoTaskWrite = {
      kind: 'task_create',
      id: `demo:task:${spec.marker.approvalId}`,
      approvalId: spec.marker.approvalId,
      listId: spec.providerListId,
      title: spec.title.slice(0, 1024),
      notes: spec.notes,
      due: spec.due,
      importance: spec.importance,
      marker: spec.marker.textMarker,
      createdAt: ctx.clock.now().toISOString(),
    };
    const out = await recordDemoWrite(this.deps, ctx, 'tasks', spec.marker.approvalId, write);
    return out.created
      ? { kind: 'created', providerId: out.item.id, webLink: null }
      : { kind: 'already_exists', providerId: out.item.id, webLink: null };
  }

  async findTaskByMarker(
    ctx: ProviderContext,
    _providerListId: string,
    marker: IdempotencyMarker,
  ): Promise<WriteOutcome | null> {
    const write = (await demoWrites(this.deps, ctx, 'tasks'))[marker.approvalId];
    return write?.kind === 'task_create'
      ? { kind: 'already_exists', providerId: write.id, webLink: null }
      : null;
  }
}
