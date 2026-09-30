/**
 * JOB-17 `approval_execute` with fake provider adapters (IT-APR-06…11): exactly-once email send
 * through the Message-ID marker probe, Google 409 on the deterministic event id, 412 → stale,
 * retries exhausted → `failed {retryable:true}` plus the failure push, in-app writes idempotent by
 * `approval:{id}`, and the provider markers themselves.
 */
import { assert, assertEquals, assertExists, assertMatch, assertRejects } from '@std/assert';
import {
  type CalendarProvider,
  type EventPatchSpec,
  type EventWriteSpec,
  type MailProvider,
  type OAuthProvider,
  type OutboundReply,
  type ProviderContext,
  ProviderError,
  type ServerProvider,
  type TaskProvider,
  type TaskWriteSpec,
  type WriteOutcome,
} from '@da/domain';
import type { ApprovalPayloadInput } from '@da/validation';
import { ApprovalPayload } from '@da/validation';
import { JobError } from '../../../jobs/types.ts';
import {
  jobContext,
  type MemoryApprovals,
  memoryApprovals,
  memoryQueue,
} from '../../../testing/workflows.ts';
import { USER_A } from '../../../testing/jwt.ts';
import { approveApproval } from '../approve.ts';
import type { ApprovalServiceDeps } from '../context.ts';
import { proposeApproval } from '../propose.ts';
import { type ApprovalExecutePayload, runApprovalExecute } from './index.ts';
import { base32hex, deriveMarker, uuidBytes } from './marker.ts';
import type { ExecuteRepo, ProviderSessions } from './model.ts';

const NOW = new Date('2026-09-23T07:00:00.000Z');
const ACC = '66666666-6666-4666-8666-666666666666';
const CAL = '77777777-7777-4777-8777-777777777777';
const EVT = '88888888-8888-4888-8888-888888888888';
const THREAD = '99999999-9999-4999-8999-999999999999';
const MESSAGE = '12121212-1212-4212-8212-121212121212';
const DRAFT = '13131313-1313-4313-8313-131313131313';

interface FakeMail {
  readonly sent: OutboundReply[];
  probes: number;
  /** Throws after the provider accepted the message (a lost response / worker crash). */
  loseResponse: boolean;
  failWith: Error | null;
  lagProbes: number;
}

interface FakeCalendar {
  readonly created: EventWriteSpec[];
  readonly patched: EventPatchSpec[];
  createError: Error | null;
  updateError: Error | null;
  existing: WriteOutcome | null;
  daApprovalId: string | null;
}

function fakeProviders() {
  const mail: FakeMail = { sent: [], probes: 0, loseResponse: false, failWith: null, lagProbes: 0 };
  const calendar: FakeCalendar = {
    created: [],
    patched: [],
    createError: null,
    updateError: null,
    existing: null,
    daApprovalId: null,
  };
  const tasks: { created: TaskWriteSpec[]; loseResponse: boolean; probes: number } = {
    created: [],
    loseResponse: false,
    probes: 0,
  };
  let opened = 0;
  const mailApi = {
    sendReply(_ctx: ProviderContext, reply: OutboundReply): Promise<WriteOutcome> {
      if (mail.failWith !== null) return Promise.reject(mail.failWith);
      mail.sent.push(reply);
      if (mail.loseResponse) {
        mail.loseResponse = false;
        return Promise.reject(new ProviderError('provider_unavailable', 503));
      }
      return Promise.resolve({
        kind: 'created',
        providerId: `m-${mail.sent.length}`,
        providerThreadId: 'thr-1',
      });
    },
    findSentByMarker(
      _ctx: ProviderContext,
      marker: { rfc822MessageId: string },
    ): Promise<WriteOutcome | null> {
      mail.probes++;
      if (mail.lagProbes > 0) {
        mail.lagProbes--;
        return Promise.resolve(null);
      }
      const hit = mail.sent.find((r) => r.marker.rfc822MessageId === marker.rfc822MessageId);
      return Promise.resolve(
        hit === undefined ? null : { kind: 'already_exists', providerId: 'm-1' },
      );
    },
  };
  const calendarApi = {
    createEvent(_ctx: ProviderContext, spec: EventWriteSpec): Promise<WriteOutcome> {
      if (calendar.createError !== null) return Promise.reject(calendar.createError);
      calendar.created.push(spec);
      return Promise.resolve({
        kind: 'created',
        providerId: spec.marker.googleEventId,
        webLink: 'https://calendar.example/e/1',
      });
    },
    findEventByMarker(): Promise<WriteOutcome | null> {
      return Promise.resolve(calendar.existing);
    },
    updateEvent(_ctx: ProviderContext, patch: EventPatchSpec): Promise<WriteOutcome> {
      if (calendar.updateError !== null) return Promise.reject(calendar.updateError);
      calendar.patched.push(patch);
      return Promise.resolve({ kind: 'updated', providerId: patch.providerEventId });
    },
    getEvent() {
      return Promise.resolve({
        providerEventId: 'evt-1',
        daApprovalId: calendar.daApprovalId,
        etag: '"etag-2"',
        status: 'confirmed',
        start: { dateTime: '2026-09-24T10:00:00Z', timeZone: 'Europe/Istanbul' },
        end: { dateTime: '2026-09-24T11:00:00Z', timeZone: 'Europe/Istanbul' },
      });
    },
  };
  const tasksApi = {
    createTask(_ctx: ProviderContext, spec: TaskWriteSpec): Promise<WriteOutcome> {
      tasks.created.push(spec);
      if (tasks.loseResponse) {
        tasks.loseResponse = false;
        return Promise.reject(new DOMException('timeout', 'TimeoutError'));
      }
      return Promise.resolve({ kind: 'created', providerId: `task-${tasks.created.length}` });
    },
    findTaskByMarker(
      _ctx: ProviderContext,
      _list: string,
      marker: { textMarker: string },
    ): Promise<WriteOutcome | null> {
      tasks.probes++;
      const hit = tasks.created.find((t) => t.marker.textMarker === marker.textMarker);
      return Promise.resolve(
        hit === undefined ? null : { kind: 'already_exists', providerId: 'task-1' },
      );
    },
  };
  const sessions: ProviderSessions = {
    open(account) {
      opened++;
      return Promise.resolve({
        provider: account.provider as ServerProvider,
        adapters: {
          oauth: {} as OAuthProvider,
          mail: mailApi as unknown as MailProvider,
          calendar: calendarApi as unknown as CalendarProvider,
          tasks: tasksApi as unknown as TaskProvider,
        },
        ctx: {} as ProviderContext,
      });
    },
  };
  return { mail, calendar, tasks, sessions, opened: () => opened };
}

function executeRepo(a: MemoryApprovals) {
  const tasks = new Map<string, { id: string; row: Record<string, unknown> }>();
  const reminders = new Map<string, { id: string; row: Record<string, unknown> }>();
  const commitments = new Map<string, { id: string; row: Record<string, unknown> }>();
  const touched: string[] = [];
  const insertOnce = (store: typeof tasks, key: string, row: Record<string, unknown>) => {
    const existing = store.get(key);
    if (existing !== undefined) return Promise.resolve({ id: existing.id, created: false });
    const id = crypto.randomUUID();
    store.set(key, { id, row });
    return Promise.resolve({ id, created: true });
  };
  const repo: ExecuteRepo = {
    approval: (id) => Promise.resolve(a.rows.has(id) ? { ...a.rows.get(id)! } : null),
    transition: (input) => a.repo.transition(input),
    accountRef(userId, accountId) {
      const acc = a.accounts.get(accountId);
      if (acc === undefined || acc.user_id !== userId) return Promise.resolve(null);
      return Promise.resolve({
        connectedAccountId: acc.id,
        userId,
        provider: acc.provider,
        providerAccountId: 'sub-1',
        email: acc.account_email,
        tenantId: null,
        tenantType: null,
        capabilitiesGranted: acc.can,
        dataSourceToggles: {
          mail_read: true,
          attachments_analyze: true,
          deadline_detect: true,
          draft_replies: true,
          calendar_read: true,
          schedule_suggest: true,
          calendar_write_with_approval:
            acc.data_source_toggles.calendar_write_with_approval !== false,
          tasks_read: true,
        },
      });
    },
    calendar: (userId, id) => a.repo.calendar(userId, id),
    calendarEvent: (userId, id) => a.repo.calendarEvent(userId, id),
    mailContext: () =>
      Promise.resolve({
        providerThreadId: 'thr-1',
        providerMessageId: 'msg-1',
        internetMessageId: '<orig-1@example.com>',
        references: ['<root@example.com>'],
      }),
    displayName: () => Promise.resolve('Yunus'),
    planFeature: (userId, key) => a.repo.planFeature(userId, key),
    insertTask: (row) => insertOnce(tasks, String(row.idempotency_key), row),
    scheduleReminder: (_userId, row) => insertOnce(reminders, String(row.idempotency_key), row),
    insertCommitment: (row) =>
      insertOnce(commitments, String(row.dedupe_key ?? row.idempotency_key), row),
    markReplyDraftSent: (_u, id) => Promise.resolve(void touched.push(`draft:${id}`)),
    markThreadAwaitingReply: (_u, id) => Promise.resolve(void touched.push(`thread:${id}`)),
    markInsightDone: (_u, id) => Promise.resolve(void touched.push(`insight:${id}`)),
  };
  return { repo, tasks, reminders, commitments, touched };
}

function setup(provider: 'google' | 'microsoft' = 'google') {
  const now = () => NOW;
  const queue = memoryQueue(now);
  const a = memoryApprovals(queue, now);
  a.addAccount({
    id: ACC,
    userId: USER_A,
    provider,
    can: ['calendar_read', 'calendar_write', 'mail_read', 'mail_send', 'tasks_write'],
  });
  a.calendars.set(CAL, {
    id: CAL,
    user_id: USER_A,
    connected_account_id: ACC,
    provider,
    provider_calendar_id: 'primary',
    name: 'Takvim',
    can_write: true,
  });
  a.calendarEvents.set(EVT, {
    id: EVT,
    user_id: USER_A,
    connected_account_id: ACC,
    calendar_id: CAL,
    provider,
    provider_event_id: 'evt-1',
    etag: '"etag-1"',
    title: 'Haftalık toplantı',
    location: null,
    start_at: '2026-09-24T08:00:00Z',
    end_at: '2026-09-24T09:00:00Z',
    all_day: false,
    start_date: null,
    end_date: null,
    time_zone: 'Europe/Istanbul',
    status: 'confirmed',
    organizer_self: true,
    attendee_count: 2,
    provider_deleted_at: null,
  });
  a.own(USER_A, 'email_thread', THREAD);
  a.own(USER_A, 'email_message', MESSAGE);
  a.planFeatures.add(`${USER_A}:follow_up_commitments`);
  const audit: unknown[] = [];
  const deps: ApprovalServiceDeps = {
    repo: a.repo,
    audit: { append: (entry) => Promise.resolve(void audit.push(entry)) },
    now,
    locale: 'tr',
    correlationId: null,
    enqueue: (input) => queue.enqueue(input),
    pokeWorker: () => Promise.resolve(),
  };
  const providers = fakeProviders();
  const exec = executeRepo(a);
  return { now, queue, a, deps, providers, exec };
}

type Setup = ReturnType<typeof setup>;

async function approved(s: Setup, payload: ApprovalPayloadInput) {
  const proposal = await proposeApproval(s.deps, {
    userId: USER_A,
    payload: ApprovalPayload.parse(payload),
    origin: payload.action_type === 'email_send' ? 'reply_draft' : 'assistant',
    originRefId: null,
    allowEmailSend: true,
  });
  const out = await approveApproval(s.deps, {
    userId: USER_A,
    approvalId: proposal.approval.id,
    idempotencyKey: proposal.approval.idempotency_key,
    payloadVersion: 1,
    approvedVia: 'approval_center',
    installationId: null,
  });
  assertEquals(out.approval.status, 'approved');
  return proposal.approval.id;
}

function run(s: Setup, id: string, attempts = 1, maxAttempts = 5) {
  const key = `approval_execute:${id}:v1`;
  const ctx = jobContext<ApprovalExecutePayload>({
    type: 'approval_execute',
    key,
    payload: { approval_id: id },
    queue: s.queue,
    now: s.now,
    attempts,
    maxAttempts,
    userId: USER_A,
  });
  return runApprovalExecute(
    {
      repo: s.exec.repo,
      sessions: s.providers.sessions,
      markers: {},
      sleep: () => Promise.resolve(),
    },
    ctx,
  );
}

const emailPayload: ApprovalPayloadInput = {
  action_type: 'email_send',
  connected_account_id: ACC,
  provider: 'google',
  mode: 'reply',
  reply_draft_id: DRAFT,
  thread: { email_thread_id: THREAD, reply_to_message_id: MESSAGE },
  to: [{ email: 'ayse@example.com' }],
  cc: [],
  subject: 'Re: Teklif',
  body_text: 'Merhaba Ayşe, teklifi yarın gönderiyorum.',
  language: 'tr',
};

const calendarPayload: ApprovalPayloadInput = {
  action_type: 'calendar_create',
  target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
  title: 'Proje toplantısı',
  time: {
    kind: 'timed',
    start: '2026-09-24T07:00:00Z',
    end: '2026-09-24T08:00:00Z',
    time_zone: 'Europe/Istanbul',
  },
  attendees: [{ email: 'ayse@example.com' }],
};

Deno.test(
  'marker: deterministic Google event id, Message-ID, transaction id and text marker',
  () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const m = deriveMarker(id, `approval:${id}:v1`);
    assertEquals(m.googleEventId, 'da7sig9o2fh50t76gc0c2ugb1j04');
    assertMatch(m.googleEventId, /^da[0-9a-v]{26}$/);
    assertEquals(m.rfc822MessageId, `<approval-${id}@mail.dijitalasistan.app>`);
    assertEquals(m.graphTransactionId, id);
    assertEquals(m.textMarker, '[DA:3b4e2e4e0859]');
    assertEquals(m.deepLinkUrl, `https://dijitalasistan.app/app/approvals/${id}`);
    assertEquals(
      deriveMarker(id, `approval:${id}:v1`, {
        mailDomain: 'mail.example',
        webUrl: 'https://x.example/',
      }).deepLinkUrl,
      `https://x.example/app/approvals/${id}`,
    );
    assertEquals(base32hex(uuidBytes(id)).length, 26);
  },
);

Deno.test(
  'IT-APR-06 email_send: a lost response and retry sends exactly once (findSentByMarker)',
  async () => {
    const s = setup('google');
    const id = await approved(s, emailPayload);
    s.providers.mail.loseResponse = true;
    const first = await assertRejects(() => run(s, id, 1), JobError);
    assertEquals(first.retryable, true);
    assertEquals(s.a.rows.get(id)?.status, 'executing');
    assertEquals(s.providers.mail.sent.length, 1);

    const second = await run(s, id, 2);
    assertEquals(second?.status, 'executed');
    assertEquals(second?.already_existed, true);
    assertEquals(s.providers.mail.sent.length, 1);
    assertEquals(s.providers.mail.probes, 1);
    const row = s.a.rows.get(id);
    assertEquals(row?.provider_idempotency_ref, `<approval-${id}@mail.dijitalasistan.app>`);
    const sent = s.providers.mail.sent[0];
    assertExists(sent);
    assertEquals(sent.marker.rfc822MessageId, `<approval-${id}@mail.dijitalasistan.app>`);
    assertEquals(sent.to, [{ address: 'ayse@example.com', name: null }]);
    assertEquals(sent.originalRfc822MessageId, '<orig-1@example.com>');
    assertEquals(s.exec.touched, [`draft:${DRAFT}`, `thread:${THREAD}`]);
    assert(s.queue.jobs.has(`gmail_sync:${ACC}:pending`));
    // A duplicate delivery of the same job after success is a no-op.
    assertEquals((await run(s, id, 1))?.skipped, 'already_executed');
    assertEquals(s.providers.mail.sent.length, 1);
  },
);

Deno.test(
  'IT-APR-08 Graph mail: Sent Items lag is probed 3 times before re-sending; first retry waits ≥30 s',
  async () => {
    const s = setup('microsoft');
    const id = await approved(s, { ...emailPayload, provider: 'microsoft' });
    s.providers.mail.loseResponse = true;
    const error = await assertRejects(() => run(s, id, 1), JobError);
    assert((error.retryAfterSeconds ?? 0) >= 30);
    s.providers.mail.lagProbes = 2;
    const out = await run(s, id, 2);
    assertEquals(out?.already_existed, true);
    assertEquals(s.providers.mail.probes, 3);
    assertEquals(s.providers.mail.sent.length, 1);
  },
);

Deno.test(
  'IT-APR-07 calendar_create: Google 409 on the deterministic id is executed, not failed',
  async () => {
    const s = setup('google');
    const id = await approved(s, calendarPayload);
    s.providers.calendar.createError = new ProviderError('conflict_exists', 409);
    const out = await run(s, id);
    assertEquals(out?.status, 'executed');
    assertEquals(out?.already_existed, true);
    const row = s.a.rows.get(id);
    assertEquals(
      row?.provider_idempotency_ref,
      deriveMarker(id, `approval:${id}:v1`).googleEventId,
    );
    assert(s.queue.jobs.has(`calendar_sync:${ACC}:${CAL}:pending`));
    assert(s.queue.jobs.has(`insight_refresh:${USER_A}:pending`));
  },
);

Deno.test(
  'IT-APR-13 calendar_create: attendees → sendUpdates=all, none without; marker and time zone',
  async () => {
    const s = setup('google');
    const id = await approved(s, calendarPayload);
    await run(s, id);
    const quiet = await approved(s, { ...calendarPayload, title: 'Odak zamanı', attendees: [] });
    await run(s, quiet);
    assertEquals(s.providers.calendar.created[1]?.sendUpdates, 'none');
    const spec = s.providers.calendar.created[0];
    assertExists(spec);
    assertEquals(spec.sendUpdates, 'all');
    assertEquals(spec.marker.approvalId, id);
    assertEquals(spec.start, { dateTime: '2026-09-24T07:00:00.000Z', timeZone: 'Europe/Istanbul' });
    assertEquals(s.a.rows.get(id)?.result?.web_link, 'https://calendar.example/e/1');
  },
);

Deno.test(
  'IT-APR-11 calendar_update: 412 is APPROVAL_STALE (terminal) with result.current and the failure push',
  async () => {
    const s = setup('google');
    const id = await approved(s, {
      action_type: 'calendar_update',
      target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
      calendar_event_id: EVT,
      changes: { title: 'Haftalık toplantı (yeni oda)' },
    });
    s.providers.calendar.updateError = new ProviderError('precondition_failed', 412);
    const error = await assertRejects(() => run(s, id), JobError);
    assertEquals(error.code, 'APPROVAL_STALE');
    assertEquals(error.retryable, false);
    const row = s.a.rows.get(id);
    assertEquals(row?.status, 'failed');
    assertEquals(row?.last_error_code, 'APPROVAL_STALE');
    assertEquals(row?.result?.retryable, false);
    assertEquals(row?.result?.current, {
      etag: '"etag-2"',
      status: 'confirmed',
      start: '2026-09-24T10:00:00Z',
      end: '2026-09-24T11:00:00Z',
      time_zone: 'Europe/Istanbul',
    });
    assert(s.queue.jobs.has(`approval_failed:${id}:1`));
  },
);

Deno.test(
  'calendar_update: If-Match carries the etag seen at proposal; a retry finds its own marker',
  async () => {
    const s = setup('google');
    const id = await approved(s, {
      action_type: 'calendar_update',
      target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
      calendar_event_id: EVT,
      changes: { description: 'Gündem eklendi' },
    });
    const row = s.a.rows.get(id);
    assertExists(row);
    row.status = 'executing';
    row.attempt_count = 1;
    s.providers.calendar.daApprovalId = id;
    const out = await run(s, id, 2);
    assertEquals(out?.status, 'executed');
    assertEquals(s.providers.calendar.patched.length, 0);

    const s2 = setup('google');
    const id2 = await approved(s2, {
      action_type: 'calendar_update',
      target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
      calendar_event_id: EVT,
      changes: { description: 'Gündem eklendi' },
    });
    await run(s2, id2);
    assertEquals(s2.providers.calendar.patched[0]?.expectedEtag, '"etag-1"');
    assertEquals(s2.providers.calendar.patched[0]?.description, 'Gündem eklendi');
    assertEquals(s2.providers.calendar.patched[0]?.sendUpdates, 'all');
  },
);

Deno.test(
  'IT-APR-10 retries exhausted: failed {retryable:true}, one failure push, then a same-key retry executes',
  async () => {
    const s = setup('google');
    const id = await approved(s, calendarPayload);
    s.providers.calendar.createError = new ProviderError('provider_unavailable', 503);
    const early = await assertRejects(() => run(s, id, 1, 3), JobError);
    assertEquals(early.retryable, true);
    assertEquals(s.a.rows.get(id)?.status, 'executing');
    assertEquals(
      [...s.queue.jobs.keys()].filter((k) => k.startsWith('approval_failed:')).length,
      0,
    );
    await assertRejects(() => run(s, id, 3, 3), JobError);
    const row = s.a.rows.get(id);
    assertEquals(row?.status, 'failed');
    assertEquals(row?.last_error_code, 'PROVIDER_UNAVAILABLE');
    assertEquals(row?.result?.retryable, true);
    assertEquals(
      [...s.queue.jobs.keys()].filter((k) => k.startsWith('approval_failed:')).length,
      1,
    );

    // "Tekrar dene": failed → executing with the same key re-queues the same job row.
    const job = s.queue.jobs.get(`approval_execute:${id}:v1`);
    assertExists(job);
    job.status = 'dead_letter';
    const retry = await approveApproval(s.deps, {
      userId: USER_A,
      approvalId: id,
      idempotencyKey: `approval:${id}:v1`,
      payloadVersion: 1,
      approvedVia: 'approval_center',
      installationId: null,
    });
    assertEquals(retry.approval.status, 'executing');
    assertEquals(s.queue.jobs.get(`approval_execute:${id}:v1`)?.status, 'queued');
    assertEquals([...s.queue.jobs.values()].filter((j) => j.type === 'approval_execute').length, 1);
    s.providers.calendar.createError = null;
    const out = await run(s, id, 1, 3);
    assertEquals(out?.status, 'executed');
    assertEquals(s.providers.calendar.created.length, 1);
  },
);

Deno.test(
  'IT-APR-09 Tasks: the marker search before insert prevents a duplicate after a lost response',
  async () => {
    const s = setup('google');
    const id = await approved(s, {
      action_type: 'task_create',
      target: { kind: 'provider', connected_account_id: ACC, task_list_id: '@default' },
      title: 'Sözleşmeyi imzala',
      notes: 'Hukuk onayından sonra',
    });
    s.providers.tasks.loseResponse = true;
    const error = await assertRejects(() => run(s, id, 1), JobError);
    assertEquals(error.code, 'UPSTREAM_TIMEOUT');
    assertEquals(error.retryable, true);
    const out = await run(s, id, 2);
    assertEquals(out?.already_existed, true);
    assertEquals(s.providers.tasks.created.length, 1);
    assertEquals(s.providers.tasks.probes, 1);
    assertEquals(
      s.providers.tasks.created[0]?.marker.textMarker,
      deriveMarker(id, `approval:${id}:v1`).textMarker,
    );
    assert(s.queue.jobs.has(`tasks_sync:${ACC}:pending`));
  },
);

Deno.test(
  'JOB-17 a write scope revoked after approval is terminal PROVIDER_SCOPE_MISSING',
  async () => {
    const s = setup('google');
    const id = await approved(s, calendarPayload);
    const acc = s.a.accounts.get(ACC);
    assertExists(acc);
    s.a.accounts.set(ACC, { ...acc, can: ['calendar_read'] });
    const error = await assertRejects(() => run(s, id), JobError);
    assertEquals(error.code, 'PROVIDER_SCOPE_MISSING');
    assertEquals(s.a.rows.get(id)?.status, 'failed');
    assertEquals(s.providers.calendar.created.length, 0);
  },
);

Deno.test(
  'JOB-17 in-app task, reminder and commitment are idempotent by approval:{id} (IT-APR-15)',
  async () => {
    const s = setup('google');
    const task = await approved(s, {
      action_type: 'task_create',
      target: { kind: 'in_app' },
      title: 'Raporu gönder',
      due: { kind: 'date', date: '2026-09-25' },
    });
    const reminder = await approved(s, {
      action_type: 'reminder_create',
      destination: { kind: 'in_app', channel: 'push' },
      title: 'Faturayı öde',
      preset: 'custom',
      fire_at: '2026-09-23T15:00:00Z',
      time_zone: 'Europe/Istanbul',
    });
    const commitment = await approved(s, {
      action_type: 'commitment_create',
      text: 'Cuma günü teklifi gönder',
      direction: 'user_owes',
      counterparty: { name: 'Ayşe' },
      due_at: '2026-09-25T12:00:00Z',
      due_precision: 'datetime',
      source: {
        source_type: 'user_input',
        source_id: null,
        source_provider: 'in_app',
        source_timestamp: NOW.toISOString(),
      },
      evidence: {
        quote: 'Cuma günü teklifi gönder',
        source: {
          source_type: 'user_input',
          source_id: null,
          source_provider: 'in_app',
          source_timestamp: NOW.toISOString(),
        },
      },
      confidence: 0.9,
    });
    for (const id of [task, reminder, commitment]) {
      const out = await run(s, id);
      assertEquals(out?.status, 'executed', id);
      assertEquals(out?.already_existed, false);
    }
    assertEquals(s.exec.tasks.get(`approval:${task}`)?.row.due_date, '2026-09-25');
    assertEquals(
      s.exec.reminders.get(`approval:${reminder}`)?.row.remind_at,
      '2026-09-23T15:00:00.000Z',
    );
    assertEquals(s.exec.commitments.size, 1);
    assertEquals(s.providers.opened(), 0);

    // Crash recovery: the row is still executing but the insert already happened.
    const row = s.a.rows.get(task);
    assertExists(row);
    row.status = 'executing';
    const again = await run(s, task, 2);
    assertEquals(again?.already_existed, true);
    assertEquals(s.exec.tasks.size, 1);
  },
);

Deno.test(
  'approval_execute skips stale versions, device executors and non-approved rows',
  async () => {
    const s = setup('google');
    const id = await approved(s, calendarPayload);
    const ctx = jobContext<ApprovalExecutePayload>({
      type: 'approval_execute',
      key: `approval_execute:${id}:v2`,
      payload: { approval_id: id },
      queue: s.queue,
      now: s.now,
    });
    const out = await runApprovalExecute(
      { repo: s.exec.repo, sessions: s.providers.sessions, markers: {} },
      ctx,
    );
    assertEquals(out?.skipped, 'state_changed');
    assertEquals(s.a.rows.get(id)?.status, 'approved');
    const missing = await run(s, crypto.randomUUID());
    assertEquals(missing?.skipped, 'approval_missing');
  },
);

Deno.test('commitments re-check Pro at execution (ENTITLEMENT_REQUIRED is terminal)', async () => {
  const s = setup('google');
  const id = await approved(s, {
    action_type: 'commitment_create',
    text: 'Raporu gönder',
    direction: 'user_owes',
    counterparty: { name: 'Mehmet' },
    due_at: null,
    due_precision: 'none',
    source: {
      source_type: 'user_input',
      source_id: null,
      source_provider: 'in_app',
      source_timestamp: NOW.toISOString(),
    },
    evidence: {
      quote: 'Raporu gönder',
      source: {
        source_type: 'user_input',
        source_id: null,
        source_provider: 'in_app',
        source_timestamp: NOW.toISOString(),
      },
    },
    confidence: 0.8,
  });
  s.a.planFeatures.clear();
  const error = await assertRejects(() => run(s, id), JobError);
  assertEquals(error.code, 'ENTITLEMENT_REQUIRED');
  assertEquals(s.exec.commitments.size, 0);
});
