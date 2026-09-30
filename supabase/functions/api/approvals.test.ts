/**
 * API-APR-01..05 (EF-APR-01, IT-APR-02/03/04/05/16/17/18 against the in-memory state machine):
 * proposals per action type, the card contract, edits rotating the key, tap-only approvals, one
 * `approval_execute` job per version, expiry, scope upgrades, rejection and device execution (R-18).
 */
import { assert, assertEquals, assertExists, assertMatch } from '@std/assert';
import {
  ApprovalApproveResponse,
  ApprovalViewResponse,
  DeviceExecutionResponse,
} from '@da/validation';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { call, createHarness, type Harness, NOW } from './testing.ts';

const ACC = '66666666-6666-4666-8666-666666666666';
const CAL = '77777777-7777-4777-8777-777777777777';
const EVT = '88888888-8888-4888-8888-888888888888';
const INST_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INST_ROW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ROW = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEVICE_CAL_HASH = 'a'.repeat(64);

function seed(
  h: Harness,
  can: ('calendar_read' | 'calendar_write')[] = ['calendar_read', 'calendar_write'],
) {
  const a = h.workflow.approvals;
  a.addAccount({ id: ACC, userId: USER_A, can });
  a.calendars.set(CAL, {
    id: CAL,
    user_id: USER_A,
    connected_account_id: ACC,
    provider: 'google',
    provider_calendar_id: 'primary',
    name: 'Takvim',
    can_write: true,
  });
  a.calendarEvents.set(EVT, {
    id: EVT,
    user_id: USER_A,
    connected_account_id: ACC,
    calendar_id: CAL,
    provider: 'google',
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
    attendee_count: 3,
    provider_deleted_at: null,
  });
  a.installations.set(INST_ROW, {
    id: INST_ROW,
    user_id: USER_A,
    installation_id: INST_CLIENT,
    platform: 'ios',
  });
  a.installations.set(OTHER_ROW, {
    id: OTHER_ROW,
    user_id: USER_A,
    installation_id: OTHER_CLIENT,
    platform: 'ios',
  });
}

const calendarCreate = (overrides: Record<string, unknown> = {}) => ({
  action_type: 'calendar_create',
  target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
  title: 'Proje toplantısı',
  time: {
    kind: 'timed',
    start: '2026-09-24T07:00:00Z',
    end: '2026-09-24T08:00:00Z',
    time_zone: 'Europe/Istanbul',
  },
  attendees: [],
  ...overrides,
});

const deviceCalendarCreate = () =>
  calendarCreate({
    target: {
      kind: 'device',
      provider: 'apple_device',
      installation_id: INST_CLIENT,
      device_calendar_hash: DEVICE_CAL_HASH,
    },
  });

const PAYLOADS: Record<string, () => Record<string, unknown>> = {
  calendar_create: () => calendarCreate(),
  calendar_update: () => ({
    action_type: 'calendar_update',
    target: { kind: 'provider', connected_account_id: ACC, calendar_id: CAL },
    calendar_event_id: EVT,
    changes: {
      time: {
        kind: 'timed',
        start: '2026-09-24T09:00:00Z',
        end: '2026-09-24T10:00:00Z',
        time_zone: 'Europe/Istanbul',
      },
    },
  }),
  task_create: () => ({
    action_type: 'task_create',
    target: { kind: 'in_app' },
    title: 'Raporu gönder',
    due: { kind: 'date', date: '2026-09-25' },
  }),
  reminder_create: () => ({
    action_type: 'reminder_create',
    destination: { kind: 'in_app', channel: 'push' },
    title: 'Faturayı öde',
    preset: 'custom',
    fire_at: '2026-09-23T15:00:00Z',
    time_zone: 'Europe/Istanbul',
  }),
  commitment_create: () => ({
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
  }),
};

async function propose(
  h: Harness,
  jwt: string,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return await call(h, 'POST', '/approvals', {
    jwt,
    key: crypto.randomUUID(),
    body: { payload, origin: 'assistant', origin_ref_id: null, ...extra },
  });
}

async function proposed(h: Harness, jwt: string, payload: Record<string, unknown>) {
  const res = await propose(h, jwt, payload);
  assertEquals(res.status, 201, await res.clone().text());
  return ApprovalViewResponse.parse(await res.json()).data;
}

async function approve(
  h: Harness,
  jwt: string,
  view: { id: string; idempotency_key: string; payload_version: number },
  options: { via?: string; installation?: string; key?: string } = {},
) {
  return await call(h, 'POST', `/approvals/${view.id}/approve`, {
    jwt,
    key: options.key ?? crypto.randomUUID(),
    body: {
      idempotency_key: view.idempotency_key,
      payload_version: view.payload_version,
      approved_via: options.via ?? 'approval_center',
    },
    ...(options.installation === undefined
      ? {}
      : { headers: { 'X-DA-Installation-Id': options.installation } }),
  });
}

function executeJobs(h: Harness) {
  return [...h.workflow.queue.jobs.values()].filter((j) => j.type === 'approval_execute');
}

Deno.test(
  'API-APR-01 propose: every non-email type is stored pending with v1 key and a consistent card',
  async () => {
    const h = await createHarness();
    seed(h);
    h.workflow.approvals.planFeatures.add(`${USER_A}:follow_up_commitments`);
    const jwt = await h.token(USER_A);
    for (const [type, build] of Object.entries(PAYLOADS)) {
      const view = await proposed(h, jwt, build());
      assertEquals(view.action_type, type);
      assertEquals(view.status, 'pending');
      assertEquals(view.payload_version, 1);
      assertEquals(view.idempotency_key, `approval:${view.id}:v1`);
      assertEquals(view.executor, 'server');
      assert(view.what.title.length > 0, type);
      if (type !== 'calendar_create') assert(view.side_effects.length > 0, type);
      assertEquals(view.exact_change.kind, type === 'calendar_update' ? 'update' : 'create');
      assert(
        h.workflow.queue.jobs.has(`approval_expiring:${view.id}`) ||
          Date.parse(view.approval_expires_at) - NOW.getTime() <= 2 * 3_600_000,
      );
    }
    assertEquals(executeJobs(h).length, 0);
    assertEquals(h.audit.filter((a) => a.action === 'user.approval.proposed').length, 5);
    const update = [...h.workflow.approvals.rows.values()].find(
      (r) => r.action_type === 'calendar_update',
    );
    assertEquals(update?.exact_change.card.precondition, '"etag-1"');
  },
);

Deno.test(
  'propose: email_send is refused on POST /approvals; commitments without Pro are 402',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const email = await propose(h, jwt, {
      action_type: 'email_send',
      connected_account_id: ACC,
      provider: 'google',
      mode: 'reply',
      reply_draft_id: crypto.randomUUID(),
      thread: { email_thread_id: crypto.randomUUID(), reply_to_message_id: crypto.randomUUID() },
      to: [{ email: 'ayse@example.com' }],
      cc: [],
      subject: 'Re: Teklif',
      body_text: 'Merhaba',
      language: 'tr',
    });
    assertEquals(email.status, 422);
    await email.body?.cancel();
    const commitment = await propose(h, jwt, PAYLOADS.commitment_create());
    assertEquals(commitment.status, 402, await commitment.clone().text());
    assertEquals((await commitment.json()).error.details.feature, 'commitments');
    assertEquals(h.workflow.approvals.rows.size, 0);
  },
);

Deno.test(
  'propose: a second pending approval for the same origin is 409 STATE_CONFLICT duplicate_pending',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const ref = crypto.randomUUID();
    const first = await propose(h, jwt, PAYLOADS.task_create(), {
      origin: 'capture',
      origin_ref_id: ref,
    });
    assertEquals(first.status, 201);
    const firstId = (await first.json()).data.id;
    const second = await propose(h, jwt, PAYLOADS.task_create(), {
      origin: 'capture',
      origin_ref_id: ref,
    });
    assertEquals(second.status, 409);
    const error = (await second.json()).error;
    assertEquals(error.code, 'STATE_CONFLICT');
    assertEquals(error.details, { reason: 'duplicate_pending', approval_id: firstId });
  },
);

Deno.test('propose: foreign calendars are 404, a timed event in the past is 422', async () => {
  const h = await createHarness();
  seed(h);
  const other = await h.token(USER_B);
  const foreign = await propose(h, other, PAYLOADS.calendar_create());
  assertEquals(foreign.status, 404);
  await foreign.body?.cancel();
  const jwt = await h.token(USER_A);
  const past = await propose(
    h,
    jwt,
    calendarCreate({
      time: {
        kind: 'timed',
        start: '2026-09-22T07:00:00Z',
        end: '2026-09-22T08:00:00Z',
        time_zone: 'Europe/Istanbul',
      },
    }),
  );
  assertEquals(past.status, 422);
  await past.body?.cancel();
});

Deno.test(
  'IT-APR-02 double approve: one approval_execute job, the repeat answers already=true',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, PAYLOADS.calendar_create());
    const first = await approve(h, jwt, view);
    assertEquals(first.status, 202);
    const body = ApprovalApproveResponse.parse(await first.json()).data;
    assertEquals(body.approval.status, 'approved');
    assertEquals(body.approval.approved_via, 'approval_center');
    assertEquals(body.execution, { mode: 'server', device_token: null, instructions: null });
    assertExists(body.job);
    assertEquals(body.job.poll_after_ms, 1500);
    const second = await approve(h, jwt, view);
    assertEquals(second.status, 202);
    const again = await second.json();
    assertEquals(again.data.already, true);
    assertEquals(again.data.job.job_id, body.job.job_id);
    const jobs = executeJobs(h);
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0]?.key, `approval_execute:${view.id}:v1`);
    assertEquals(jobs[0]?.payload, { approval_id: view.id });
    assertEquals(h.audit.filter((a) => a.action === 'user.approval.approved').length, 1);
  },
);

Deno.test(
  'IT-APR-03 edit: a new version rotates the key; approving with the old key is 409',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, PAYLOADS.calendar_create());
    const edit = await call(h, 'PATCH', `/approvals/${view.id}`, {
      jwt,
      key: crypto.randomUUID(),
      body: {
        expected_payload_version: 1,
        payload_patch: { title: 'Proje toplantısı (ertelendi)' },
      },
    });
    assertEquals(edit.status, 200);
    const edited = ApprovalViewResponse.parse(await edit.json()).data;
    assertEquals(edited.payload_version, 2);
    assertEquals(edited.idempotency_key, `approval:${view.id}:v2`);
    assert(edited.exact_change.fields.some((f) => f.after?.includes('ertelendi') === true));

    const stale = await approve(h, jwt, view);
    assertEquals(stale.status, 409);
    const error = (await stale.json()).error;
    assertEquals(error.code, 'APPROVAL_STATE_CONFLICT');
    assertEquals(error.details.payload_version, 2);
    assertEquals(error.details.idempotency_key, `approval:${view.id}:v2`);

    const staleEdit = await call(h, 'PATCH', `/approvals/${view.id}`, {
      jwt,
      key: crypto.randomUUID(),
      body: { expected_payload_version: 1, payload_patch: { title: 'x' } },
    });
    assertEquals(staleEdit.status, 409);
    assertEquals((await staleEdit.json()).error.details.reason, 'version_mismatch');

    const immutable = await call(h, 'PATCH', `/approvals/${view.id}`, {
      jwt,
      key: crypto.randomUUID(),
      body: { expected_payload_version: 2, payload_patch: { target: { kind: 'device' } } },
    });
    assertEquals(immutable.status, 422);
    await immutable.body?.cancel();

    const ok = await approve(h, jwt, edited);
    assertEquals(ok.status, 202);
    await ok.body?.cancel();
    assertEquals(executeJobs(h)[0]?.key, `approval_execute:${view.id}:v2`);
  },
);

Deno.test(
  'EF-APR-01 / IT-APR-16 R-03: approved_via=voice is 422 voice_approval_not_allowed for every type',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    h.workflow.approvals.planFeatures.add(`${USER_A}:follow_up_commitments`);
    for (const build of Object.values(PAYLOADS)) {
      const view = await proposed(h, jwt, build());
      const res = await approve(h, jwt, view, { via: 'voice' });
      assertEquals(res.status, 422);
      const error = (await res.json()).error;
      assertEquals(error.code, 'VALIDATION_FAILED');
      assertEquals(error.details.reason, 'voice_approval_not_allowed');
      const other = await approve(h, jwt, view, { via: 'shake' });
      assertEquals((await other.json()).error.details.reason, 'approved_via_invalid');
      assertEquals(h.workflow.approvals.rows.get(view.id)?.status, 'pending');
      const card = await approve(h, jwt, view, { via: 'voice_card' });
      assertEquals(card.status, 202);
      await card.body?.cancel();
    }
    assertEquals(executeJobs(h).length, Object.keys(PAYLOADS).length);
  },
);

Deno.test(
  'IT-APR-05 expiry: approving an expired approval is 409 with status expired, no job',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, PAYLOADS.task_create());
    const row = h.workflow.approvals.rows.get(view.id);
    assertExists(row);
    row.approval_expires_at = new Date(NOW.getTime() - 1000).toISOString();
    const res = await approve(h, jwt, view);
    assertEquals(res.status, 409);
    const error = (await res.json()).error;
    assertEquals(error.code, 'APPROVAL_STATE_CONFLICT');
    assertEquals(error.details.status, 'expired');
    assertEquals(h.workflow.approvals.rows.get(view.id)?.status, 'expired');
    assertEquals(executeJobs(h).length, 0);
  },
);

Deno.test(
  'IT-APR-04 scope: a missing write scope is shown in advance and approve is 424 with the upgrade',
  async () => {
    const h = await createHarness();
    seed(h, ['calendar_read']);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, PAYLOADS.calendar_create());
    assertEquals(view.scope_status.state, 'upgrade_required');
    const res = await approve(h, jwt, view);
    assertEquals(res.status, 424);
    const error = (await res.json()).error;
    assertEquals(error.code, 'PROVIDER_SCOPE_MISSING');
    assertEquals(error.details.capability, 'calendar_write');
    assertEquals(h.workflow.approvals.rows.get(view.id)?.status, 'pending');
    assertEquals(h.workflow.approvals.rows.get(view.id)?.requires_scope, 'calendar_write');
    assertEquals(executeJobs(h).length, 0);

    const account = h.workflow.approvals.accounts.get(ACC);
    assertExists(account);
    h.workflow.approvals.accounts.set(ACC, {
      ...account,
      can: ['calendar_read', 'calendar_write'],
    });
    const retry = await approve(h, jwt, view);
    assertEquals(retry.status, 202);
    await retry.body?.cancel();
    assertEquals(h.workflow.approvals.rows.get(view.id)?.requires_scope, null);
  },
);

Deno.test(
  'API-APR-04 / IT-APR-18 reject: pending → rejected; approved rows are never rejectable (R-06)',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const pending = await proposed(h, jwt, PAYLOADS.task_create());
    const rejected = await call(h, 'POST', `/approvals/${pending.id}/reject`, {
      jwt,
      key: crypto.randomUUID(),
      body: { reason: 'user_reject', learn: true },
    });
    assertEquals(rejected.status, 200);
    const view = ApprovalViewResponse.parse(await rejected.json()).data;
    assertEquals(view.status, 'rejected');
    assertEquals(h.workflow.approvals.feedback.length, 1);
    assert(h.workflow.approvals.feedback[0]?.statement.includes('Görev'));

    const approved = await proposed(h, jwt, calendarCreate({ title: 'Başka toplantı' }));
    const ok = await approve(h, jwt, approved);
    await ok.body?.cancel();
    const late = await call(h, 'POST', `/approvals/${approved.id}/reject`, {
      jwt,
      key: crypto.randomUUID(),
      body: { reason: 'user_cancel' },
    });
    assertEquals(late.status, 409);
    assertEquals((await late.json()).error.details.status, 'approved');
  },
);

Deno.test(
  'approve replay: the same Idempotency-Key answers the current state without a second job',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, PAYLOADS.calendar_create());
    const key = crypto.randomUUID();
    const first = await approve(h, jwt, view, { key });
    const second = await approve(h, jwt, view, { key });
    assertEquals(first.status, 202);
    assertEquals(second.status, 202);
    assertEquals((await first.json()).data.approval.id, (await second.json()).data.approval.id);
    assertEquals(executeJobs(h).length, 1);
  },
);

Deno.test(
  'IT-APR-17 device execution: claim on the destination, token-checked result, no-op repeat',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, deviceCalendarCreate());
    assertEquals(view.executor, 'device');
    assertEquals(view.device_installation_id, INST_ROW);

    // Approved on another installation: stays approved until the destination claims it.
    const elsewhere = await approve(h, jwt, view, { installation: OTHER_CLIENT });
    assertEquals(elsewhere.status, 202);
    const approvedBody = ApprovalApproveResponse.parse(await elsewhere.json()).data;
    assertEquals(approvedBody.approval.status, 'approved');
    assertEquals(approvedBody.execution.mode, 'device');
    assertEquals(approvedBody.execution.device_token, null);
    assertEquals(approvedBody.job, null);
    assertEquals(executeJobs(h).length, 0);

    const wrong = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': OTHER_CLIENT },
      body: { phase: 'claim', installation_id: OTHER_CLIENT },
    });
    assertEquals(wrong.status, 403);
    await wrong.body?.cancel();

    const claim = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': INST_CLIENT },
      body: { phase: 'claim', installation_id: INST_CLIENT },
    });
    assertEquals(claim.status, 200);
    const claimed = DeviceExecutionResponse.parse(await claim.json()).data;
    assert('device_token' in claimed);
    assertEquals(claimed.approval.status, 'executing');
    assertMatch(claimed.device_token, /^[A-Za-z0-9_-]{43}$/);
    assertEquals(claimed.instructions.action_type, 'calendar_create');

    const forged = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': INST_CLIENT },
      body: {
        phase: 'result',
        installation_id: INST_CLIENT,
        device_token: 'A'.repeat(43),
        status: 'executed',
      },
    });
    assertEquals(forged.status, 403);
    assertEquals((await forged.json()).error.details.reason, 'device_token_invalid');

    const resultBody = {
      phase: 'result',
      installation_id: INST_CLIENT,
      device_token: claimed.device_token,
      status: 'executed',
      already_existed: false,
      device_ref_hash: 'b'.repeat(64),
    };
    const done = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': INST_CLIENT },
      body: resultBody,
    });
    assertEquals(done.status, 200);
    assertEquals((await done.json()).data.status, 'executed');
    assert(h.workflow.queue.jobs.has(`insight_refresh:${USER_A}:pending`));
    const events = h.workflow.approvals.events.filter((e) => e.approval_id === view.id).length;

    const repeat = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': INST_CLIENT },
      body: resultBody,
    });
    assertEquals(repeat.status, 200);
    assertEquals((await repeat.json()).data.status, 'executed');
    assertEquals(
      h.workflow.approvals.events.filter((e) => e.approval_id === view.id).length,
      events,
    );
    assertEquals(h.workflow.approvals.rows.get(view.id)?.provider_idempotency_ref, 'b'.repeat(64));
  },
);

Deno.test(
  'IT-APR-17 device approve on the destination installation starts execution in the same request',
  async () => {
    const h = await createHarness();
    seed(h);
    const jwt = await h.token(USER_A);
    const view = await proposed(h, jwt, deviceCalendarCreate());
    const res = await approve(h, jwt, view, { installation: INST_CLIENT, via: 'inline_sheet' });
    assertEquals(res.status, 202);
    const body = ApprovalApproveResponse.parse(await res.json()).data;
    assertEquals(body.approval.status, 'executing');
    assertEquals(body.execution.mode, 'device');
    assertExists(body.execution.device_token);
    assertEquals(body.execution.instructions?.action_type, 'calendar_create');

    const failed = await call(h, 'POST', `/approvals/${view.id}/device-execution`, {
      jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': INST_CLIENT },
      body: {
        phase: 'result',
        installation_id: INST_CLIENT,
        device_token: body.execution.device_token,
        status: 'failed',
        error_code: 'permission_denied',
      },
    });
    assertEquals(failed.status, 200);
    const view2 = (await failed.json()).data;
    assertEquals(view2.status, 'failed');
    assertEquals(view2.failure.code, 'DEVICE_WRITE_FAILED');
  },
);

Deno.test('IT-APR-05 approval routes are scoped to the owner (404 for another user)', async () => {
  const h = await createHarness();
  seed(h);
  const jwt = await h.token(USER_A);
  const view = await proposed(h, jwt, PAYLOADS.task_create());
  const other = await h.token(USER_B);
  const res = await approve(h, other, view);
  assertEquals(res.status, 404);
  await res.body?.cancel();
  assertEquals(h.workflow.approvals.rows.get(view.id)?.status, 'pending');
});
