/**
 * The adapter interfaces are exercised with a small in-memory TaskProvider and a fixture
 * NormalizedEvent/NormalizedMessage, so a contract change that breaks implementers fails here.
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_VALUES } from '../../src/enums.ts';
import { ProviderError } from '../../src/providers/errors.ts';
import {
  DEVICE_PROVIDERS,
  READ_CAPABILITIES,
  SERVER_PROVIDERS,
  WRITE_CAPABILITY_FOR,
  type IdempotencyMarker,
  type NormalizedEvent,
  type NormalizedMessage,
  type NormalizedTask,
  type ProviderContext,
  type TaskCursor,
  type TaskProvider,
  type TaskWriteSpec,
  type WriteOutcome,
} from '../../src/providers/types.ts';
import { isConferencingUrl } from '../../src/url-safety.ts';

const context: ProviderContext = {
  account: {
    connectedAccountId: 'acc-1',
    userId: 'user-1',
    provider: 'demo',
    providerAccountId: 'demo-sub',
    email: 'selin@example.com',
    tenantId: null,
    tenantType: null,
    capabilitiesGranted: ['tasks_read', 'tasks_write'],
    dataSourceToggles: {
      mail_read: true,
      attachments_analyze: false,
      deadline_detect: true,
      draft_replies: true,
      calendar_read: true,
      schedule_suggest: true,
      calendar_write_with_approval: true,
      tasks_read: true,
    },
  },
  tokens: { get: () => Promise.resolve('token') },
  quota: { acquire: () => Promise.resolve() },
  clock: { now: () => new Date('2026-09-23T06:00:00Z') },
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  correlationId: 'corr-1',
};

const marker: IdempotencyMarker = {
  approvalId: '8a4f1c9e-1111-4222-8333-944455556666',
  idempotencyKey: 'approval:8a4f1c9e-1111-4222-8333-944455556666:v1',
  rfc822MessageId: '<approval-8a4f1c9e-1111-4222-8333-944455556666@mail.dijitalasistan.app>',
  googleEventId: 'da0123456789abcdefghijklmnopqr',
  graphTransactionId: '8a4f1c9e-1111-4222-8333-944455556666',
  textMarker: '[DA:0123456789ab]',
  deepLinkUrl: 'https://dijitalasistan.app/app/approvals/8a4f1c9e-1111-4222-8333-944455556666',
};

/** An in-memory TaskProvider honouring the idempotency-probe contract (§3.12). */
function memoryTasks(): TaskProvider & { tasks: NormalizedTask[] } {
  const tasks: NormalizedTask[] = [];
  return {
    provider: 'demo',
    tasks,
    listTaskLists: () =>
      Promise.resolve([
        { providerListId: 'list-1', name: 'Görevler', isDefault: true, deleted: false },
      ]),
    changesSince: (_ctx, providerListId, cursor: TaskCursor | null) =>
      Promise.resolve({
        upserts: tasks.filter((t) => t.providerListId === providerListId),
        deleted: [],
        nextCursor: { kind: 'demo_clock', value: cursor?.value ?? '0' },
        pageToken: null,
      }),
    createTask: (_ctx, spec: TaskWriteSpec): Promise<WriteOutcome> => {
      const existing = tasks.find((t) => t.daMarker === spec.marker.textMarker);
      if (existing !== undefined) {
        return Promise.resolve({ kind: 'already_exists', providerId: existing.providerTaskId });
      }
      const task: NormalizedTask = {
        providerTaskId: `task-${tasks.length + 1}`,
        providerListId: spec.providerListId,
        title: spec.title,
        notesSnippet: spec.notes,
        status: 'open',
        due: spec.due,
        completedAt: null,
        importance: spec.importance,
        updatedAt: null,
        daMarker: spec.marker.textMarker,
        deleted: false,
      };
      tasks.push(task);
      return Promise.resolve({ kind: 'created', providerId: task.providerTaskId });
    },
    findTaskByMarker: (_ctx, providerListId, m) => {
      const found = tasks.find(
        (t) => t.providerListId === providerListId && t.daMarker === m.textMarker,
      );
      return Promise.resolve(
        found === undefined ? null : { kind: 'already_exists', providerId: found.providerTaskId },
      );
    },
  };
}

describe('provider adapter contracts (INTEGRATION_PLAN §2)', () => {
  it('splits providers into server and device providers', () => {
    expect([...SERVER_PROVIDERS, ...DEVICE_PROVIDERS].sort()).toEqual([...PROVIDER_VALUES].sort());
    expect(READ_CAPABILITIES.map((c) => WRITE_CAPABILITY_FOR[c])).toEqual([
      'mail_send',
      'calendar_write',
      'tasks_write',
    ]);
  });

  it('a TaskProvider write is idempotent through its marker', async () => {
    const provider = memoryTasks();
    const spec: TaskWriteSpec = {
      providerListId: 'list-1',
      title: 'Teklifi gönder',
      notes: null,
      due: { date: '2026-09-25' },
      importance: 'normal',
      marker,
    };
    const first = await provider.createTask(context, spec);
    const retry = await provider.createTask(context, spec);
    expect(first).toEqual({ kind: 'created', providerId: 'task-1' });
    expect(retry).toEqual({ kind: 'already_exists', providerId: 'task-1' });
    expect(
      await provider.findTaskByMarker(context, 'list-1', marker, '2026-09-23T00:00:00Z'),
    ).toEqual(retry);
    const changes = await provider.changesSince(context, 'list-1', null);
    expect(changes.upserts).toHaveLength(1);
    expect(changes.nextCursor.kind).toBe('demo_clock');
  });

  it('normalised DTOs carry no body and allow-listed conference URLs only', () => {
    const event: NormalizedEvent = {
      providerEventId: 'evt-1',
      providerCalendarId: 'primary',
      iCalUid: 'evt-1@google.com',
      seriesMasterId: null,
      originalStart: null,
      isOccurrence: false,
      status: 'confirmed',
      title: 'Kuzey Lojistik · Teklif görüşmesi',
      descriptionSnippet: null,
      location: null,
      start: { dateTime: '2026-09-23T11:00:00Z', timeZone: 'Europe/Istanbul' },
      end: { dateTime: '2026-09-23T11:30:00Z', timeZone: 'Europe/Istanbul' },
      allDay: false,
      organizer: { address: 'ahmet@kuzeylojistik.example', name: 'Ahmet Yılmaz' },
      userIsOrganizer: false,
      attendees: [],
      conferenceUrl: 'https://meet.google.com/abc-defg-hij',
      transparency: 'busy',
      visibility: 'default',
      etag: null,
      updatedAt: null,
      daApprovalId: null,
      deleted: false,
    };
    expect(event.conferenceUrl === null || isConferencingUrl(event.conferenceUrl)).toBe(true);

    const message: NormalizedMessage = {
      providerMessageId: 'm1',
      providerThreadId: 't1',
      rfc822MessageId: null,
      inReplyTo: null,
      references: [],
      folder: 'inbox',
      labels: ['INBOX'],
      providerCategory: 'primary',
      from: { address: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' },
      replyTo: [],
      to: [],
      cc: [],
      subject: 'Sözleşme taslağı',
      snippet: 'Ekte sözleşme taslağını bulabilirsin.',
      sentAt: null,
      receivedAt: '2026-09-23T05:42:00Z',
      isRead: false,
      isFlagged: false,
      providerImportance: null,
      hasAttachments: true,
      sizeBytes: null,
      headers: {
        listUnsubscribe: false,
        listId: null,
        precedence: null,
        autoSubmitted: null,
        authentication: null,
        priority: null,
      },
      webLink: null,
      deleted: false,
    };
    expect(Object.keys(message)).not.toContain('body');
    expect(message.snippet.length).toBeLessThanOrEqual(200);
  });

  it('adapters report failures as ProviderError', async () => {
    const failing: Pick<TaskProvider, 'listTaskLists'> = {
      listTaskLists: () =>
        Promise.reject(new ProviderError('auth_invalid_grant', 400, null, 'invalid_grant')),
    };
    await expect(failing.listTaskLists(context)).rejects.toMatchObject({
      code: 'auth_invalid_grant',
    });
  });
});
