/**
 * THR-13 Replayed write actions (SECURITY_AND_PRIVACY_PLAN §2 THR-13, CTL-3.16; M§115, R-06;
 * TEST_PLAN TST-DB-08, TST-EF-11, IT-APR-02/06). An approved `email_send` goes through the shipped
 * approval service and JOB-17 executor against the real Gmail adapter (HTTP stubbed):
 * - a double tap with the same key is `already: true` with one execution job; a stale key, another
 *   user or a replay after an edit cannot approve;
 * - the provider accepts the send but the response is lost; the retry finds the message by its
 *   deterministic RFC 822 Message-ID marker (`rfc822msgid:`) and does not send again;
 * - a duplicate delivery of the job after success is a no-op.
 * The SQL state machine (`private.transition_approval`, one job per `approval_execute:{id}:v{n}`)
 * is covered by `050_approvals` and `300_threats_writes.test.sql`.
 */
import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import type { ProviderContext, ServerProvider } from '@da/domain';
import { ApprovalPayload, type ApprovalPayloadInput } from '@da/validation';
import { fromBase64Url } from '../../_shared/crypto/encoding.ts';
import { AppError } from '../../_shared/errors.ts';
import { JobError } from '../../_shared/jobs/types.ts';
import { GOOGLE_ENDPOINTS } from '../../_shared/providers/google/config.ts';
import { GmailAdapter } from '../../_shared/providers/google/gmail.ts';
import { approveApproval } from '../../_shared/services/approvals/approve.ts';
import type { ApprovalServiceDeps } from '../../_shared/services/approvals/context.ts';
import {
  type ApprovalExecutePayload,
  runApprovalExecute,
} from '../../_shared/services/approvals/execute/index.ts';
import type {
  ExecuteRepo,
  ProviderSessions,
} from '../../_shared/services/approvals/execute/model.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { jsonResponse, stubFetch } from '../../_shared/testing/fetch.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { jobContext, memoryApprovals, memoryQueue } from '../../_shared/testing/workflows.ts';

const NOW = new Date('2026-09-23T07:00:00.000Z');
const ACC = '66666666-6666-4666-8666-666666666666';
const THREAD = '99999999-9999-4999-8999-999999999999';
const MESSAGE = '12121212-1212-4212-8212-121212121212';
const DRAFT = '13131313-1313-4313-8313-131313131313';

const EMAIL: ApprovalPayloadInput = {
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

/** Gmail over a stub: the first send is accepted by "Google" but the response is lost. */
function gmailStub() {
  const accepted: { raw: string; messageId: string }[] = [];
  let loseNext = true;
  const stub = stubFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname.endsWith('/messages/send') && call.method === 'POST') {
      const raw = (JSON.parse(call.body ?? '{}') as { raw: string }).raw;
      const mime = new TextDecoder().decode(fromBase64Url(raw));
      const messageId = /^Message-ID:\s*(\S+)/im.exec(mime)?.[1] ?? '';
      accepted.push({ raw: mime, messageId });
      if (loseNext) {
        loseNext = false;
        throw new TypeError('connection reset after the provider accepted the message');
      }
      return jsonResponse({ id: `sent-${accepted.length}`, threadId: 'thr-1' });
    }
    if (url.pathname.endsWith('/messages') && call.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const wanted = /^rfc822msgid:(.+)$/.exec(q)?.[1];
      const hit = accepted.find((a) => a.messageId.replace(/[<>]/g, '') === wanted);
      return jsonResponse(
        hit === undefined ? {} : { messages: [{ id: 'sent-1', threadId: 'thr-1' }] },
      );
    }
    return new Response('unexpected', { status: 599 });
  });
  const gmail = new GmailAdapter({
    endpoints: GOOGLE_ENDPOINTS,
    http: { fetch: stub.fetch },
    pubsubTopic: null,
  });
  return { gmail, stub, accepted };
}

function setup() {
  const now = () => NOW;
  const queue = memoryQueue(now);
  const a = memoryApprovals(queue, now);
  a.addAccount({ id: ACC, userId: USER_A, provider: 'google', can: ['mail_read', 'mail_send'] });
  a.own(USER_A, 'email_thread', THREAD);
  a.own(USER_A, 'email_message', MESSAGE);
  const deps: ApprovalServiceDeps = {
    repo: a.repo,
    audit: { append: () => Promise.resolve() },
    now,
    locale: 'tr',
    correlationId: null,
    enqueue: (input) => queue.enqueue(input),
    pokeWorker: () => Promise.resolve(),
  };
  const g = gmailStub();
  const sessions: ProviderSessions = {
    open: (account) =>
      Promise.resolve({
        provider: account.provider as ServerProvider,
        adapters: { mail: g.gmail } as never,
        ctx: {
          account,
          tokens: { get: () => Promise.resolve('ya29.test-access-token') },
          quota: { acquire: () => Promise.resolve() },
          clock: { now },
          log: { info() {}, warn() {}, error() {} },
          correlationId: 'security-test',
        } as ProviderContext,
      }),
  };
  const repo: ExecuteRepo = {
    approval: (id) => Promise.resolve(a.rows.has(id) ? { ...a.rows.get(id)! } : null),
    transition: (input) => a.repo.transition(input),
    accountRef: (userId, accountId) => {
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
          calendar_write_with_approval: true,
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
    insertTask: () => Promise.resolve({ id: crypto.randomUUID(), created: true }),
    scheduleReminder: () => Promise.resolve({ id: crypto.randomUUID(), created: true }),
    insertCommitment: () => Promise.resolve({ id: crypto.randomUUID(), created: true }),
    markReplyDraftSent: () => Promise.resolve(),
    markThreadAwaitingReply: () => Promise.resolve(),
    markInsightDone: () => Promise.resolve(),
  };
  const execute = (id: string, attempts: number) =>
    runApprovalExecute(
      { repo, sessions, markers: {}, sleep: () => Promise.resolve() },
      jobContext<ApprovalExecutePayload>({
        type: 'approval_execute',
        key: `approval_execute:${id}:v1`,
        payload: { approval_id: id },
        queue,
        now,
        attempts,
        maxAttempts: 5,
        userId: USER_A,
      }),
    );
  return { a, deps, queue, g, execute };
}

Deno.test(
  'THR-13: double taps, stale keys and foreign replays of an approve never create a second execution',
  async () => {
    const s = setup();
    const proposal = await proposeApproval(s.deps, {
      userId: USER_A,
      payload: ApprovalPayload.parse(EMAIL),
      origin: 'reply_draft',
      originRefId: null,
      allowEmailSend: true,
    });
    const id = proposal.approval.id;
    const approve = (over: Partial<Parameters<typeof approveApproval>[1]> = {}) =>
      approveApproval(s.deps, {
        userId: USER_A,
        approvalId: id,
        idempotencyKey: proposal.approval.idempotency_key,
        payloadVersion: 1,
        approvedVia: 'approval_center',
        installationId: null,
        ...over,
      });
    // Before approval: a stale key or version cannot approve.
    const stale = await assertRejects(() => approve({ payloadVersion: 2 }), AppError);
    assertEquals(stale.code, 'APPROVAL_STATE_CONFLICT');
    // A captured request replayed by another user finds nothing.
    const foreign = await assertRejects(() => approve({ userId: USER_B }), AppError);
    assertEquals(foreign.code, 'NOT_FOUND');
    const first = await approve();
    assertEquals(first.approval.status, 'approved');
    const second = await approve();
    assertEquals(second.already, true, 'the same key answers the current state');
    const other = await assertRejects(
      () => approve({ idempotencyKey: crypto.randomUUID() }),
      AppError,
    );
    assertEquals(other.code, 'APPROVAL_STATE_CONFLICT');
    const jobs = [...s.queue.jobs.values()].filter((j) => j.type === 'approval_execute');
    assertEquals(
      jobs.map((j) => j.key),
      [`approval_execute:${id}:v1`],
    );
  },
);

Deno.test(
  'THR-13: a lost Gmail response is resolved by the Message-ID marker — exactly one message is sent',
  async () => {
    const s = setup();
    const proposal = await proposeApproval(s.deps, {
      userId: USER_A,
      payload: ApprovalPayload.parse(EMAIL),
      origin: 'reply_draft',
      originRefId: null,
      allowEmailSend: true,
    });
    const id = proposal.approval.id;
    await approveApproval(s.deps, {
      userId: USER_A,
      approvalId: id,
      idempotencyKey: proposal.approval.idempotency_key,
      payloadVersion: 1,
      approvedVia: 'approval_center',
      installationId: null,
    });

    const failed = await assertRejects(() => s.execute(id, 1), JobError);
    assertEquals(failed.retryable, true, 'an unknown outcome is retried, not failed');
    assertEquals(s.g.accepted.length, 1, 'Google accepted the first send');
    assertEquals(s.a.rows.get(id)?.status, 'executing');

    const retry = await s.execute(id, 2);
    assertEquals(retry?.status, 'executed');
    assertEquals(retry?.already_existed, true);
    assertEquals(s.g.accepted.length, 1, 'the retry did not send a second message');
    const marker = `<approval-${id}@mail.dijitalasistan.app>`;
    assertEquals(s.g.accepted[0]?.messageId, marker);
    const probe = s.g.stub.calls.find((c) => c.method === 'GET');
    assertExists(probe);
    assertEquals(
      new URL(probe.url).searchParams.get('q'),
      `rfc822msgid:${marker.replace(/[<>]/g, '')}`,
    );
    assertEquals(s.a.rows.get(id)?.provider_idempotency_ref, marker);

    const duplicate = await s.execute(id, 1);
    assertEquals(duplicate?.skipped, 'already_executed');
    assertEquals(s.g.stub.calls.filter((c) => c.url.endsWith('/messages/send')).length, 1);
    assert(s.g.accepted[0]?.raw.includes('In-Reply-To: <orig-1@example.com>'));
  },
);
