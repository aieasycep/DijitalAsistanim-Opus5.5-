/**
 * IT-APR-* (TEST_PLAN §6.5; API_CONTRACTS API-APR-01…05, API-MAIL-02/05, JOB-17 `approval_execute`;
 * INTEGRATION_PLAN §7 provider writes and idempotency markers; R-03, R-06, R-18).
 */
import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  freshIdentities,
  it,
  json,
  mock,
  one,
  q,
  releaseJobs,
} from './_harness/mod.ts';
import {
  approval,
  approve,
  calendarSetup,
  draftAndSubmit,
  execute,
  mailSetup,
  propose,
  simulateCrashAfterProviderWrite,
  tasksSetup,
  timed,
  transitions,
} from './_harness/approvals.ts';
import { sha256Hex } from './_harness/flows.ts';

function sends() {
  return mock.requests('/gmail/v1/users/me/messages/send');
}

function mimeOf(body: string): string {
  const raw = (JSON.parse(body) as { raw: string }).raw.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(raw + '='.repeat((4 - (raw.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

it(
  'IT-APR-01',
  'propose → approve → execute email_send over Gmail with thread headers and the approval Message-ID',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { draftId, approval: view } = await draftAndSubmit(user, setup.messageId);
    assertEquals(view.status, 'pending');
    const res = await approve(user, String(view.id), Number(view.payload_version));
    assertEquals(res.status, 202, JSON.stringify(res.body));
    await execute();
    const row = await approval(String(view.id));
    assertEquals(row.status, 'executed');
    const path = await transitions(String(view.id));
    for (const step of ['pending→approved', 'approved→executing', 'executing→executed'])
      assert(
        path.some((p) => p.endsWith(step)),
        `${step} in ${path.join(', ')}`,
      );
    const sent = await sends();
    assertEquals(sent.length, 1);
    const body = JSON.parse(sent[0]?.body ?? '{}') as { threadId?: string };
    assertEquals(body.threadId, '18f2a0c1d0000001');
    const mime = mimeOf(sent[0]?.body ?? '');
    assertMatch(mime, /^In-Reply-To: <18f2a0c1d0000001@mail\.example\.com>/m);
    assertMatch(mime, /^References: .*<18f2a0c1d0000001@mail\.example\.com>/m);
    assertMatch(mime, /^Subject: (=\?UTF-8\?[BQ]\?.+\?=|Re: .+)/im);
    assertMatch(
      mime,
      new RegExp(`^Message-ID: <approval-${String(view.id)}@mail\\.dijitalasistan\\.app>`, 'mi'),
    );
    assertMatch(mime, /^To: .*ahmet\.yilmaz@kuzeylojistik\.example/im);
    const draft = await one<{ status: string }>(
      `select status from public.reply_drafts where id = $1`,
      [draftId],
    );
    assertEquals(draft.status, 'sent');
    const insights = await q<{ status: string }>(
      `select status from public.insights where user_id = $1 and entity_type = 'email_thread' and entity_id = $2 and kind = 'reply_needed'`,
      [user.id, setup.threadId],
    );
    for (const i of insights) assertEquals(i.status, 'done');
  },
);

it(
  'IT-APR-02',
  'the same approve key twice concurrently executes once; the second answers already',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      approve(user, String(view.id), Number(view.payload_version), { key }),
      approve(user, String(view.id), Number(view.payload_version), { key }),
    ]);
    // Concurrent duplicates of one HTTP key: one executes, the other is either replayed (202) or told
    // the first is still in progress (409); never a second execution.
    const statuses = [a, b].map((r) => r.status).sort();
    assert(
      statuses[0] === 202 && [202, 409].includes(statuses[1] ?? 0),
      JSON.stringify([a.body, b.body]),
    );
    const second = await approve(user, String(view.id), Number(view.payload_version), { key });
    assertEquals(
      (second.body.data as { already?: boolean }).already === true || second.status === 202,
      true,
    );
    await execute();
    assertEquals((await sends()).length, 1);
    assertEquals(
      await count(
        `select 1 from public.jobs where type = 'approval_execute' and payload ->> 'approval_id' = $1`,
        [view.id],
      ),
      1,
    );
  },
);

it('IT-APR-03', 'an edit then a stale payload version → 409 APPROVAL_STATE_CONFLICT', async () => {
  const user = await createUser({ pro: true });
  const setup = await mailSetup(user);
  const { approval: view } = await draftAndSubmit(user, setup.messageId);
  const edited = await call('api', 'PATCH', `/approvals/${view.id}`, {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: {
      expected_payload_version: view.payload_version,
      payload_patch: { body_text: 'Merhaba Ahmet Bey, revize teklif bugün 16:00’da sizde.' },
    },
  });
  const out = await json<{ data: { payload_version: number } }>(edited);
  assertEquals(edited.status, 200, JSON.stringify(out));
  assertEquals(out.data.payload_version, Number(view.payload_version) + 1);
  const stale = await approve(user, String(view.id), Number(view.payload_version));
  assertEquals(stale.status, 409);
  assertEquals((stale.body.error as { code: string }).code, 'APPROVAL_STATE_CONFLICT');
  assertEquals((await approval(String(view.id))).status, 'pending');
});

it(
  'IT-APR-04',
  'missing mail_send → 424 PROVIDER_SCOPE_MISSING with the upgrade and resume details',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user, ['mail_read']);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    const res = await approve(user, String(view.id), Number(view.payload_version));
    assertEquals(res.status, 424, JSON.stringify(res.body));
    const error = res.body.error as { code: string; details: { upgrade: Record<string, unknown> } };
    assertEquals(error.code, 'PROVIDER_SCOPE_MISSING');
    const upgrade = error.details.upgrade;
    assertEquals(upgrade.capability, 'mail_send');
    assertEquals(upgrade.account_id ?? upgrade.connected_account_id, setup.accountId);
    // The upgrade call to make (API-INT-02) carries the resume target.
    const resume = ((upgrade.upgrade as { body?: { resume?: unknown } } | undefined)?.body
      ?.resume ?? upgrade.resume) as { approval_id?: string } | undefined;
    assertEquals(resume?.approval_id, view.id, JSON.stringify(error.details));
    assertEquals((await approval(String(view.id))).status, 'pending');
    assertEquals((await sends()).length, 0);
  },
);

it(
  'IT-APR-05',
  "expired → 409 APPROVAL_STATE_CONFLICT (status expired); another user's approval → 404",
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    const intruder = await createUser({ pro: true });
    const foreign = await approve(intruder, String(view.id), Number(view.payload_version));
    assertEquals(foreign.status, 404);
    assertEquals((foreign.body.error as { code: string }).code, 'NOT_FOUND');
    await q(
      `update public.approval_actions set approval_expires_at = now() - interval '1 minute' where id = $1`,
      [view.id],
    );
    const expired = await approve(user, String(view.id), Number(view.payload_version));
    assertEquals(expired.status, 409);
    const error = expired.body.error as { code: string; details?: { status?: string } };
    assertEquals(error.code, 'APPROVAL_STATE_CONFLICT');
    if (error.details?.status !== undefined) assertEquals(error.details.status, 'expired');
    assertEquals((await sends()).length, 0);
  },
);

it(
  'IT-APR-06',
  'Gmail replay detection: a sent message found by rfc822msgid is not sent again',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    await approve(user, String(view.id), Number(view.payload_version));
    await execute();
    assertEquals((await sends()).length, 1);
    await simulateCrashAfterProviderWrite(String(view.id));
    await execute();
    const search = (await mock.requests('/gmail/v1/users/me/messages')).filter(
      (r) => r.method === 'GET' && String(r.query.q ?? '').startsWith('rfc822msgid:'),
    );
    assert(search.length >= 1, 'rfc822msgid search before resending');
    assertEquals(
      String(search[0]?.query.q),
      `rfc822msgid:approval-${view.id}@mail.dijitalasistan.app`,
    );
    assertEquals((await sends()).length, 1);
    assertEquals((await approval(String(view.id))).status, 'executed');
  },
);

function calendarPayload(target: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    action_type: 'calendar_create',
    target,
    title: 'Mehmet ile teklif görüşmesi',
    time: timed(26),
    attendees: [],
    reminders_minutes: [15],
    ...extra,
  };
}

it(
  'IT-APR-07',
  'Google Calendar replay: the deterministic event id answers 409 and is treated as done',
  async () => {
    const user = await createUser({ pro: true });
    const { accountId, calendarId } = await calendarSetup(user);
    const created = await propose(
      user,
      calendarPayload({
        kind: 'provider',
        connected_account_id: accountId,
        calendar_id: calendarId,
      }),
    );
    assertEquals(created.status, 201, JSON.stringify(created.body));
    const view = created.body.data as Record<string, unknown>;
    assertEquals((await approve(user, String(view.id), Number(view.payload_version))).status, 202);
    await execute();
    const inserts = () =>
      mock
        .requests('/calendar/v3/calendars/primary/events')
        .then((r) =>
          r.filter(
            (x) => x.method === 'POST' && x.path === '/calendar/v3/calendars/primary/events',
          ),
        );
    const first = await inserts();
    assertEquals(
      first.length,
      1,
      JSON.stringify(
        (await mock.requests('/calendar/v3')).map((r) => [
          r.seq,
          r.method,
          r.path,
          r.status,
          r.query,
        ]),
      ),
    );
    const eventId = (JSON.parse(first[0]?.body ?? '{}') as { id: string }).id;
    assertMatch(eventId, /^[0-9a-v]{5,1024}$/);
    await simulateCrashAfterProviderWrite(String(view.id));
    await execute();
    const again = await inserts();
    assert(
      again.length <= 2,
      JSON.stringify(again.map((r) => [r.status, (JSON.parse(r.body) as { id: string }).id])),
    );
    assertEquals(
      new Set(again.map((r) => (JSON.parse(r.body) as { id: string }).id)).size,
      1,
      JSON.stringify(
        again.map((r) => [r.seq, r.status, (JSON.parse(r.body) as { id: string }).id]),
      ),
    );
    if (again.length === 2) assertEquals(again[1]?.status, 409);
    const state = await mock.google<{ events: Record<string, unknown[]> }>({ op: 'state' });
    assertEquals((state.events.primary ?? []).length, 1, JSON.stringify(state.events));
    assertEquals((await approval(String(view.id))).status, 'executed');
  },
);

it('IT-APR-08', 'Graph replay: transactionId event and marked reply are written once', async () => {
  const user = await createUser({ pro: true });
  const { accountId, calendarId } = await calendarSetup(user, 'microsoft');
  const created = await propose(
    user,
    calendarPayload({ kind: 'provider', connected_account_id: accountId, calendar_id: calendarId }),
  );
  assertEquals(created.status, 201, JSON.stringify(created.body));
  const view = created.body.data as Record<string, unknown>;
  await approve(user, String(view.id), Number(view.payload_version));
  await execute();
  await simulateCrashAfterProviderWrite(String(view.id));
  await execute();
  const posts = (await mock.requests('/graph/v1.0/me/calendars/')).filter(
    (r) => r.method === 'POST' && r.path.endsWith('/events'),
  );
  for (const p of posts)
    assertEquals((JSON.parse(p.body) as { transactionId?: string }).transactionId, view.id);
  const state = await mock.graph<{ events: unknown[]; sent: Record<string, unknown>[] }>({
    op: 'state',
  });
  assertEquals(state.events.length, 1);
  assertEquals((await approval(String(view.id))).status, 'executed');

  // Mail reply with the extended-property marker; the Sent Items check prevents a second reply.
  await mock.graph({
    op: 'messages',
    folder: 'inbox',
    fixtures: ['graph/messages_delta_page1.json'],
  });
  await freshIdentities();
  const mailUser = await createUser({ pro: true });
  const setup = await mailSetup(mailUser, ['mail_read', 'mail_send'], 'microsoft');
  const { approval: reply } = await draftAndSubmit(mailUser, setup.messageId);
  await approve(mailUser, String(reply.id), Number(reply.payload_version));
  await execute();
  await simulateCrashAfterProviderWrite(String(reply.id));
  await execute();
  const replies = (await mock.requests('/graph/v1.0/me/messages/')).filter(
    (r) => r.method === 'POST' && r.path.endsWith('/reply'),
  );
  assertEquals(replies.length, 1);
  const marker = JSON.stringify(JSON.parse(replies[0]?.body ?? '{}'));
  assert(marker.includes(String(reply.id)), 'extended-property marker carries the approval id');
  assertEquals((await approval(String(reply.id))).status, 'executed');
});

it(
  'IT-APR-09',
  'Tasks / To Do replay: the DA-{approvalId} marker search prevents a duplicate',
  async () => {
    for (const provider of ['google', 'microsoft'] as const) {
      const user = await createUser({ pro: true });
      const { accountId, listId } = await tasksSetup(user, provider);
      const list = { provider_list_id: listId };
      const created = await propose(user, {
        action_type: 'task_create',
        target: {
          kind: 'provider',
          connected_account_id: accountId,
          task_list_id: String(list.provider_list_id),
        },
        title: 'Selin’e madde 4 yorumunu gönder',
        due: { kind: 'date', date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
      });
      assertEquals(created.status, 201, JSON.stringify(created.body));
      const view = created.body.data as Record<string, unknown>;
      await approve(user, String(view.id), Number(view.payload_version));
      await execute();
      await simulateCrashAfterProviderWrite(String(view.id));
      await execute();
      const path = provider === 'google' ? '/tasks/v1/lists/' : '/graph/v1.0/me/todo/lists/';
      const writes = (await mock.requests(path)).filter((r) => r.method === 'POST');
      assertEquals(writes.length, 1, `${provider} task inserts`);
      const body = writes[0]?.body ?? '';
      const key = String((await approval(String(view.id))).idempotency_key);
      const marker =
        provider === 'google' ? `[DA:${(await sha256Hex(key)).slice(0, 12)}]` : String(view.id);
      assert(body.includes(marker), `${provider} marker ${marker} in ${body}`);
      assertEquals((await approval(String(view.id))).status, 'executed');
    }
  },
);

it(
  'IT-APR-10',
  'Gmail 503 until max_attempts → failed provider_unavailable; a retry with the same key executes',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    await mock.script('POST /gmail/v1/users/me/messages/send', [
      { status: 503, fixture: 'gmail/backend_503.json', times: 40 },
    ]);
    const key = crypto.randomUUID();
    await approve(user, String(view.id), Number(view.payload_version), { key });
    for (let i = 0; i < 8; i++) {
      await releaseJobs(`type = 'approval_execute'`);
      await drain({ types: ['approval_execute'], rounds: 1 });
    }
    const row = await approval(String(view.id));
    assertEquals(row.status, 'failed');
    assertEquals(String(row.last_error_code).toLowerCase(), 'provider_unavailable');
    const job = await one<{ status: string }>(
      `select status from public.jobs where type = 'approval_execute' and payload ->> 'approval_id' = $1 order by created_at desc limit 1`,
      [view.id],
    );
    assertEquals(job.status, 'dead_letter');
    await releaseJobs();
    await drain({ types: ['notification'] });
    assertEquals(
      await count(
        `select 1 from public.notifications where user_id = $1 and category = 'approval'`,
        [user.id],
      ),
      1,
    );
    await mock.reset();
    const retry = await approve(user, String(view.id), Number(row.payload_version), { key });
    assertEquals(retry.status, 202, JSON.stringify(retry.body));
    await execute();
    assertEquals((await approval(String(view.id))).status, 'executed');
    assert((await transitions(String(view.id))).some((t) => t.endsWith('failed→executing')));
  },
);

it(
  'IT-APR-11',
  'calendar_update with a stale etag → 412 → APPROVAL_STALE, failed with result.current',
  async () => {
    const user = await createUser({ pro: true });
    await mock.google({
      op: 'events',
      events: [
        {
          id: 'evtmehmetstale',
          summary: 'Mehmet müşteri toplantısı',
          start: { dateTime: timed(5).start },
          end: { dateTime: timed(5).end },
          organizer: { email: 'yunus.demir@example.com', self: true },
        },
      ],
    });
    const { accountId, calendarId } = await calendarSetup(user);
    const event = await one<{ id: string }>(
      `select id from public.calendar_events where connected_account_id = $1 and provider_event_id = 'evtmehmetstale'`,
      [accountId],
    );
    const created = await propose(user, {
      action_type: 'calendar_update',
      target: { kind: 'provider', connected_account_id: accountId, calendar_id: calendarId },
      calendar_event_id: event.id,
      changes: { time: timed(6) },
    });
    assertEquals(created.status, 201, JSON.stringify(created.body));
    const view = created.body.data as Record<string, unknown>;
    const approved = await approve(user, String(view.id), Number(view.payload_version));
    assertEquals(approved.status, 202, JSON.stringify(approved.body));
    // Someone edits the event at the provider after the approval: the approved etag is now stale.
    await fetch(
      `${Deno.env.get('DA_IT_MOCK_URL')}/calendar/v3/calendars/primary/events/evtmehmetstale`,
      {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ya29.mock-editor', 'content-type': 'application/json' },
        body: JSON.stringify({ location: 'Karaköy' }),
      },
    ).then((r) => r.body?.cancel());
    await execute();
    const patches = (
      await mock.requests('/calendar/v3/calendars/primary/events/evtmehmetstale')
    ).filter((r) => r.method === 'PATCH' && r.headers['if-match'] !== undefined);
    assert(
      patches.some((p) => p.status === 412),
      JSON.stringify({
        calls: (await mock.requests('/calendar/v3')).map((r) => [
          r.method,
          r.path,
          r.status,
          r.headers['if-match'] ?? null,
        ]),
        row: await approval(String(view.id)),
      }),
    );
    const row = await approval(String(view.id));
    assertEquals(row.status, 'failed');
    assertEquals(row.last_error_code, 'APPROVAL_STALE');
    assert(
      (row.result as { current?: unknown } | null)?.current !== undefined,
      JSON.stringify(row.result),
    );
  },
);

it('IT-APR-12', 'Graph reply uses POST /me/messages/{id}/reply, never createReply', async () => {
  await mock.graph({
    op: 'messages',
    folder: 'inbox',
    fixtures: ['graph/messages_delta_page1.json'],
  });
  const user = await createUser({ pro: true });
  const setup = await mailSetup(user, ['mail_read', 'mail_send'], 'microsoft');
  const { approval: view } = await draftAndSubmit(user, setup.messageId);
  await approve(user, String(view.id), Number(view.payload_version));
  await execute();
  const graph = await mock.requests('/graph/v1.0/me/messages/');
  assert(graph.some((r) => r.method === 'POST' && /\/me\/messages\/[^/]+\/reply$/.test(r.path)));
  assertFalse(graph.some((r) => /createReply/i.test(r.path)));
  assertEquals((await approval(String(view.id))).status, 'executed');
});

it(
  'IT-APR-13',
  'Google Calendar create: no attendees → sendUpdates=none; attendees → sendUpdates=all, stated as a side effect',
  async () => {
    const user = await createUser({ pro: true });
    const { accountId, calendarId } = await calendarSetup(user);
    const target = { kind: 'provider', connected_account_id: accountId, calendar_id: calendarId };
    const solo = await propose(user, calendarPayload(target));
    const withGuests = await propose(
      user,
      calendarPayload(target, {
        attendees: [{ email: 'mehmet@yilmazendustri.example' }],
        time: timed(30),
      }),
    );
    const guestView = withGuests.body.data as {
      side_effects: { code: string }[];
      id: string;
      payload_version: number;
    };
    assert(
      guestView.side_effects.some(
        (s) => s.code === 'attendees_notified' || s.code === 'invites_sent',
      ),
      JSON.stringify(guestView.side_effects),
    );
    for (const v of [solo.body.data, withGuests.body.data] as {
      id: string;
      payload_version: number;
    }[]) {
      await approve(user, v.id, v.payload_version);
    }
    await execute();
    const inserts = (await mock.requests('/calendar/v3/calendars/primary/events')).filter(
      (r) => r.method === 'POST' && r.path === '/calendar/v3/calendars/primary/events',
    );
    const updates = inserts.map((r) => [
      ((JSON.parse(r.body) as { attendees?: unknown[] }).attendees ?? []).length,
      r.query.sendUpdates,
    ]);
    assert(
      updates.some(([n, s]) => n === 0 && s === 'none'),
      JSON.stringify(updates),
    );
    assert(
      updates.some(([n, s]) => Number(n) > 0 && s === 'all'),
      JSON.stringify(updates),
    );
  },
);

it(
  'IT-APR-14',
  'capture batch: 3 selected actions → 3 pending approvals sharing batch_id, approved via capture_batch',
  async () => {
    const user = await createUser({ pro: true });
    const res = await call('api', 'POST', '/captures', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {
        client_capture_id: crypto.randomUUID(),
        share_origin: 'in_app',
        source: {
          kind: 'text',
          text: 'CK Enerji elektrik faturası 842,00 TL, son ödeme 30 Eylül 2026. Selin’e sözleşme madde 4 yorumunu yarın 12:00’ye kadar gönder. Deniz’e bütçe onayını 2 Ekim 2026’ya kadar ilet.',
        },
      },
    });
    const capture = await json<{ data: { id: string } }>(res);
    assert([200, 201, 202].includes(res.status), JSON.stringify(capture));
    const analyze = await call('api', 'POST', `/captures/${capture.data.id}/analyze`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {},
    });
    assert([200, 202].includes(analyze.status), await analyze.text());
    await execute();
    const row = await one<{
      extracted: { item_id: string; proposed_action: string | null }[] | null;
    }>(`select extracted from public.captures where id = $1`, [capture.data.id]);
    // In-app destinations only (no calendar is connected for this user).
    const items = (row.extracted ?? [])
      .filter((i) => i.proposed_action === 'reminder_create')
      .slice(0, 3);
    assert(items.length >= 1, JSON.stringify(row.extracted));
    const actions = await call('api', 'POST', `/captures/${capture.data.id}/actions`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { items: items.map((i) => ({ item_id: i.item_id, action_type: i.proposed_action })) },
    });
    const out = await json<{
      data: {
        batch_id: string;
        approvals: { id: string; batch_id: string; payload_version: number; status: string }[];
      };
    }>(actions);
    assert([200, 201].includes(actions.status), JSON.stringify(out));
    assertEquals(out.data.approvals.length, items.length);
    for (const a of out.data.approvals) {
      assertEquals(a.status, 'pending');
      assertEquals(a.batch_id, out.data.batch_id);
    }
    // API-CAP-04: one pending approval per (capture, item_id, action_type) — a repeated selection
    // (another HTTP key) returns the same pending approvals.
    const again = await call('api', 'POST', `/captures/${capture.data.id}/actions`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { items: items.map((i) => ({ item_id: i.item_id, action_type: i.proposed_action })) },
    });
    await again.body?.cancel();
    assertEquals(
      await count(
        `select 1 from public.approval_actions where user_id = $1 and batch_id is not null`,
        [user.id],
      ),
      items.length,
    );
    for (const a of out.data.approvals)
      assertEquals(
        (await approve(user, a.id, a.payload_version, { via: 'capture_batch' })).status,
        202,
      );
    await execute();
    for (const a of out.data.approvals) {
      const r = await approval(a.id);
      assertEquals(r.approved_via, 'capture_batch');
      assertEquals(r.status, 'executed');
    }
    // The internal actions ran once each.
    assertEquals(
      await count(`select 1 from public.reminders where user_id = $1`, [user.id]),
      items.length,
    );
  },
);

it(
  'IT-APR-15',
  'post-meeting "Kaydet": a commitment_create written and executed in place, once',
  async () => {
    const user = await createUser({ pro: true });
    await mock.google({
      op: 'events',
      events: [
        {
          id: 'evtmehmetpast',
          summary: 'Mehmet müşteri toplantısı',
          start: { dateTime: timed(-2).start },
          end: { dateTime: timed(-1).start },
          attendees: [{ email: 'mehmet@yilmazendustri.example' }],
        },
      ],
    });
    const { accountId } = await calendarSetup(user);
    const event = await one<{ id: string }>(
      `select id from public.calendar_events where connected_account_id = $1 and provider_event_id = 'evtmehmetpast'`,
      [accountId],
    );
    const post = await call('api', 'POST', `/meetings/${event.id}/post`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {
        client_post_id: crypto.randomUUID(),
        text: 'Teklif v2’yi cuma gününe kadar Mehmet Bey’e göndereceğim.',
        source: 'text',
      },
    });
    const out = await json<{
      data: {
        proposals: { approval: { id: string; payload_version: number; action_type: string } }[];
      };
    }>(post);
    assert([200, 201].includes(post.status), JSON.stringify(out));
    assert(out.data.proposals.length >= 1, JSON.stringify(out));
    for (const p of out.data.proposals) {
      assertEquals(p.approval.action_type, 'commitment_create');
      assertEquals(
        (await approve(user, p.approval.id, p.approval.payload_version, { via: 'in_place' }))
          .status,
        202,
      );
    }
    await execute();
    for (const p of out.data.proposals) {
      const row = await approval(p.approval.id);
      assertEquals(row.approved_via, 'in_place');
      assertEquals(row.status, 'executed');
    }
    const commitments = await count(`select 1 from public.commitments where user_id = $1`, [
      user.id,
    ]);
    assertEquals(commitments, out.data.proposals.length);
    const first = out.data.proposals[0]?.approval;
    if (first !== undefined)
      await approve(user, first.id, first.payload_version, { via: 'in_place' });
    await execute();
    assertEquals(
      await count(`select 1 from public.commitments where user_id = $1`, [user.id]),
      commitments,
    );
  },
);

it(
  'IT-APR-16',
  'voice-originated proposal: approved only via the visible card; approved_via=voice → 422',
  async () => {
    const user = await createUser({ pro: true });
    const created = await propose(
      user,
      {
        action_type: 'reminder_create',
        destination: { kind: 'in_app', channel: 'push' },
        title: 'Selin’e madde 4 yorumu',
        preset: 'custom',
        fire_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        time_zone: 'Europe/Istanbul',
      },
      { origin: 'voice' },
    );
    assertEquals(created.status, 201, JSON.stringify(created.body));
    const view = created.body.data as { id: string; payload_version: number };
    const spoken = await approve(user, view.id, view.payload_version, { via: 'voice' });
    assertEquals(spoken.status, 422);
    const err = spoken.body.error as { code: string; details?: { reason?: string } };
    assertEquals(err.code, 'VALIDATION_FAILED');
    assertEquals(err.details?.reason, 'voice_approval_not_allowed');
    assertEquals((await approval(view.id)).status, 'pending');
    assertEquals(
      (await approve(user, view.id, view.payload_version, { via: 'voice_card' })).status,
      202,
    );
    assertEquals((await approval(view.id)).approved_via, 'voice_card');
  },
);

it(
  'IT-APR-17',
  'device-executed approval: mode device, claim + result, wrong installation 422, missing result → failed',
  async () => {
    const user = await createUser({ pro: true });
    const installation = crypto.randomUUID();
    await q(
      `insert into public.app_installations (user_id, installation_id, platform, app_version, build_number, push_enabled,
       platform_capabilities, device_hash, last_seen_at, created_at, updated_at)
     values ($1, $2::uuid, 'ios', '1.4.0', '812', true, '{}'::jsonb, sha256(convert_to($3, 'UTF8')), now(), now(), now())`,
      [user.id, installation, installation],
    );
    const target = {
      kind: 'device',
      provider: 'apple_device',
      installation_id: installation,
      device_calendar_hash: await sha256Hex('ios-home-calendar'),
    };
    const created = await propose(user, calendarPayload(target));
    assertEquals(created.status, 201, JSON.stringify(created.body));
    const view = created.body.data as { id: string; payload_version: number };
    // Approved on the destination installation itself: `approved → executing` in the same request
    // with a device token, and no worker job.
    const approved = await approve(user, view.id, view.payload_version, { installation });
    assertEquals(approved.status, 202, JSON.stringify(approved.body));
    const data = approved.body.data as {
      execution: { mode: string; device_token: string | null };
      approval: { status: string };
      job: unknown;
    };
    assertEquals(data.execution.mode, 'device');
    assertEquals(data.approval.status, 'executing');
    assertEquals(data.job, null);
    assertEquals(
      await count(
        `select 1 from public.jobs where type = 'approval_execute' and payload ->> 'approval_id' = $1`,
        [view.id],
      ),
      0,
    );
    const token = data.execution.device_token ?? '';
    assert(token.length >= 43, 'device token');
    // API_CONTRACTS API-APR-05: an installation mismatch is FORBIDDEN.
    const other = crypto.randomUUID();
    const wrong = await call('api', 'POST', `/approvals/${view.id}/device-execution`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': other },
      body: {
        phase: 'result',
        installation_id: other,
        device_token: token,
        status: 'executed',
        device_ref_hash: await sha256Hex('ev-1'),
      },
    });
    await wrong.body?.cancel();
    assertEquals(wrong.status, 403);
    const done = await call('api', 'POST', `/approvals/${view.id}/device-execution`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      headers: { 'X-DA-Installation-Id': installation },
      body: {
        phase: 'result',
        installation_id: installation,
        device_token: token,
        status: 'executed',
        device_ref_hash: await sha256Hex('ev-1'),
      },
    });
    assertEquals(done.status, 200, await done.text());
    assertEquals((await approval(view.id)).status, 'executed');

    // A second device approval whose result never arrives fails through scheduler_tick.
    const second = await propose(user, calendarPayload(target, { time: timed(50) }));
    const sv = second.body.data as { id: string; payload_version: number };
    await approve(user, sv.id, sv.payload_version, { installation });
    await q(
      `update public.approval_actions set executing_at = now() - interval '11 minutes', approved_at = now() - interval '11 minutes' where id = $1`,
      [sv.id],
    );
    const tick = await one<{ r: { device_approvals_failed: number } }>(
      `select private.scheduler_tick(now()) as r`,
    );
    assert(tick.r.device_approvals_failed >= 1, JSON.stringify(tick.r));
    const failed = await approval(sv.id);
    assertEquals(failed.status, 'failed');
    assertEquals(failed.last_error_code, 'DEVICE_RESULT_MISSING');
  },
);

it(
  'IT-APR-18',
  'undo is client-only: no server path returns an approved approval to pending or rejected',
  async () => {
    const user = await createUser({ pro: true });
    const setup = await mailSetup(user);
    const { approval: view } = await draftAndSubmit(user, setup.messageId);
    const before = Date.now();
    await approve(user, String(view.id), Number(view.payload_version));
    const job = await one<{ run_after: Date }>(
      `select run_after from public.jobs where type = 'approval_execute' and payload ->> 'approval_id' = $1`,
      [view.id],
    );
    assert(new Date(job.run_after).getTime() - before < 2000, 'enqueued with no delay');
    const reject = await call('api', 'POST', `/approvals/${view.id}/reject`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { reason: 'user_cancel' },
    });
    await reject.body?.cancel();
    assertEquals(reject.status, 409);
    const edit = await call('api', 'PATCH', `/approvals/${view.id}`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {
        expected_payload_version: view.payload_version,
        payload_patch: { body_text: 'Değişti.' },
      },
    });
    await edit.body?.cancel();
    assertEquals(edit.status, 409);
    const status = (await approval(String(view.id))).status;
    assert(['approved', 'executing'].includes(String(status)), String(status));
    await execute();
  },
);
