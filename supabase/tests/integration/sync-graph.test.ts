/**
 * IT-SYNC-11…18 (TEST_PLAN §6.3): Microsoft Graph deltas, subscriptions and throttling, Google Tasks
 * and To Do polls, the device calendar snapshot (API-INT-06) and Data Source Controls (API-INT-05).
 */
import { assert, assertEquals } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  it,
  json,
  mock,
  one,
  q,
  releaseJobs,
} from './_harness/mod.ts';
import { connect, sha256Hex } from './_harness/flows.ts';
import {
  accountEmail,
  gmailPush,
  mailboxState,
  messagesOf,
  syncedGoogle,
  syncedMicrosoft,
  syncState,
} from './_harness/sync.ts';

const HOUR = 3_600_000;
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

async function manualSync(
  user: { jwt: string },
  accountId: string,
  resources: string[],
): Promise<void> {
  await q(`delete from public.rate_limits`);
  const res = await call('api', 'POST', `/integrations/${accountId}/sync`, {
    jwt: user.jwt,
    body: { resources },
  });
  assertEquals(res.status, 202, await res.text());
  await releaseJobs();
  await drain();
}

async function deltaCalls(folder: string) {
  return (await mock.requests(`/graph/v1.0/me/mailFolders/${folder}/messages/delta`)).filter(
    (r) => r.method === 'GET',
  );
}

it(
  'IT-SYNC-11',
  'Graph message delta: nextLink → deltaLink per folder, immutable ids dedupe',
  async () => {
    await mock.graph({ op: 'page_size', value: 2 });
    await mock.graph({
      op: 'messages',
      folder: 'inbox',
      fixtures: ['graph/messages_delta_page1.json'],
    });
    const user = await createUser();
    const accountId = await syncedMicrosoft(user);
    const inbox = await deltaCalls('inbox');
    assert(
      inbox.some((r) => r.query.$skiptoken !== undefined),
      'followed @odata.nextLink',
    );
    assert((await deltaCalls('sentitems')).length >= 1);
    for (const resource of ['graph_mail_inbox', 'graph_mail_sentitems']) {
      const state = await syncState(accountId, resource);
      assert(String(state.cursor).includes('$deltatoken='), `${resource}: ${String(state.cursor)}`);
    }
    assertEquals((await messagesOf(accountId)).map((m) => m.provider_message_id).sort(), [
      'AAMkAGI2THVSAAA1',
      'AAMkAGI2THVSAAA2',
      'AAMkAGI2THVSAAA3',
    ]);
    await mock.graph({
      op: 'messages',
      folder: 'inbox',
      fixtures: ['graph/messages_delta_final.json'],
    });
    await manualSync(user, accountId, ['mail']);
    assert(
      (await deltaCalls('inbox')).some((r) => r.query.$deltatoken !== undefined),
      'incremental round used the delta link',
    );
    assertEquals((await messagesOf(accountId)).length, 4);
    for (const r of await mock.requests('/graph'))
      assert((r.headers.prefer ?? '').includes('IdType="ImmutableId"'), `${r.method} ${r.path}`);
  },
);

it('IT-SYNC-12', 'Graph delta 410 syncStateNotFound re-baselines the folder', async () => {
  await mock.graph({
    op: 'messages',
    folder: 'inbox',
    fixtures: ['graph/messages_delta_page1.json'],
  });
  const user = await createUser();
  const accountId = await syncedMicrosoft(user);
  await mock.script('GET /graph/v1.0/me/mailFolders/inbox/messages/delta', [
    { status: 410, fixture: 'graph/delta_410_syncStateNotFound.json' },
  ]);
  await manualSync(user, accountId, ['mail']);
  const calls = await deltaCalls('inbox');
  const gone = calls.find((r) => r.status === 410);
  assert(gone !== undefined && gone.query.$deltatoken !== undefined, 'the delta link answered 410');
  assert(
    calls.some((r) => r.seq > gone.seq && r.query.$deltatoken === undefined && r.status === 200),
    'fresh baseline after 410',
  );
  assert(String((await syncState(accountId, 'graph_mail_inbox')).cursor).includes('$deltatoken='));
  assertEquals((await messagesOf(accountId)).length, 3);
});

it(
  'IT-SYNC-13',
  'Graph calendarView/delta re-baseline recomputes the [today − 2 d, today + 60 d] window',
  async () => {
    const user = await createUser();
    const accountId = await syncedMicrosoft(user, ['calendar_read']);
    const state = await syncState(accountId, 'graph_calendar_view');
    const span =
      (Date.parse(String(state.window_end)) - Date.parse(String(state.window_start))) / 86_400_000;
    assert(span >= 61.5 && span <= 63, `window ${span} days`);
    await q(
      `update public.sync_states set window_start = window_start - interval '10 days', window_end = window_end - interval '10 days',
       rebaseline_due_at = now() - interval '1 minute' where id = $1`,
      [state.id],
    );
    const tick = await one<{ r: { rebaselines: number } }>(
      `select private.scheduler_tick(now()) as r`,
    );
    assert(tick.r.rebaselines >= 1, JSON.stringify(tick.r));
    await releaseJobs();
    await drain();
    const after = await syncState(accountId, 'graph_calendar_view');
    const start = Date.parse(String(after.window_start));
    const end = Date.parse(String(after.window_end));
    assert(
      Math.abs(start - (Date.now() - 2 * 86_400_000)) < 86_400_000,
      String(after.window_start),
    );
    assert(Math.abs(end - (Date.now() + 60 * 86_400_000)) < 86_400_000, String(after.window_end));
  },
);

async function lifecycle(
  subscriptionId: string,
  clientState: string,
  event: string,
): Promise<Response> {
  return await call('webhooks-microsoft', 'POST', '/lifecycle', {
    headers: { 'Content-Type': 'application/json' },
    rawBody: JSON.stringify({
      value: [
        {
          subscriptionId,
          subscriptionExpirationDateTime: isoIn(40 * HOUR),
          tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
          clientState,
          lifecycleEvent: event,
        },
      ],
    }),
  });
}

async function subscriptions(): Promise<Record<string, string>[]> {
  return (await mock.graph<{ subscriptions: Record<string, string>[] }>({ op: 'state' }))
    .subscriptions;
}

it(
  'IT-SYNC-14',
  'Graph subscriptions: hashed clientState, renew < 48 h, lifecycle reauthorize / recreate / missed',
  async () => {
    const user = await createUser();
    const accountId = await syncedMicrosoft(user);
    const created = await subscriptions();
    assert(created.length >= 1);
    const sub = created[0] as Record<string, string>;
    assertEquals(sub.lifecycleNotificationUrl, Deno.env.get('MICROSOFT_GRAPH_LIFECYCLE_URL'));
    assertEquals(sub.notificationUrl, Deno.env.get('MICROSOFT_GRAPH_NOTIFICATION_URL'));
    const state = await one<{ id: string; watch_token_hash: Uint8Array }>(
      `select id, watch_token_hash from public.sync_states where connected_account_id = $1 and watch_id = $2`,
      [accountId, sub.id],
    );
    const hex = [...state.watch_token_hash].map((b) => b.toString(16).padStart(2, '0')).join('');
    assertEquals(hex, await sha256Hex(String(sub.clientState)));

    await q(
      `update public.sync_states set watch_expires_at = now() + interval '40 hours', watch_renew_after = now() - interval '1 minute' where id = $1`,
      [state.id],
    );
    await q(`select private.scheduler_tick(now())`);
    await releaseJobs();
    await drain({ types: ['watch_renewal'] });
    assert(
      (await mock.requests(`/graph/v1.0/subscriptions/${sub.id}`)).some(
        (r) => r.method === 'PATCH',
      ),
      'renewed < 48 h',
    );

    const before = (await mock.requests(`/graph/v1.0/subscriptions/${sub.id}`)).length;
    const reauth = await lifecycle(sub.id, String(sub.clientState), 'reauthorizationRequired');
    assertEquals(reauth.status, 202, await reauth.text());
    await releaseJobs();
    await drain();
    assert(
      (await mock.requests(`/graph/v1.0/subscriptions/${sub.id}`)).length > before,
      'reauthorized / renewed',
    );

    const creates = async () =>
      (await mock.requests('/graph/v1.0/subscriptions')).filter(
        (r) => r.method === 'POST' && r.path === '/graph/v1.0/subscriptions',
      ).length;
    const posts = await creates();
    const removed = await lifecycle(sub.id, String(sub.clientState), 'subscriptionRemoved');
    assertEquals(removed.status, 202);
    await releaseJobs();
    await drain();
    assertEquals(await creates(), posts + 1);

    const current = await one<{ watch_id: string }>(
      `select watch_id from public.sync_states where id = $1`,
      [state.id],
    );
    const latest = (await subscriptions()).find((x) => x.id === current.watch_id);
    const missed = await lifecycle(current.watch_id, String(latest?.clientState), 'missed');
    assertEquals(missed.status, 202);
    assert(
      (await count(
        `select 1 from public.jobs where connected_account_id = $1 and type = 'reconciliation'`,
        [accountId],
      )) >= 1,
    );
    const forged = await lifecycle(current.watch_id, 'forged-client-state', 'missed');
    await forged.body?.cancel();
    assertEquals(forged.status, 401);
  },
);

it(
  'IT-SYNC-15',
  'Graph throttling: ≤ 4 concurrent calls per mailbox; 429 Retry-After respected',
  async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `AAMkAGI2THROTTLE${String(i).padStart(2, '0')}`,
      conversationId: `AAQkTHROTTLE${i}`,
      subject: `Rapor ${i}`,
      bodyPreview: `Haftalık rapor ${i}`,
      from: { emailAddress: { name: 'Elif Arslan', address: 'elif.arslan@example.com' } },
      toRecipients: [
        { emailAddress: { name: 'Yunus Demir', address: 'yunus.demir@kuzeylojistik.example' } },
      ],
      receivedDateTime: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      isRead: false,
      importance: 'high',
      hasAttachments: false,
      internetMessageHeaders: [],
    }));
    await mock.graph({ op: 'messages', folder: 'inbox', messages: many });
    await mock.script('GET /graph/v1.0/me/mailFolders/sentitems/messages/delta', [
      {
        status: 429,
        headers: { 'Retry-After': '3' },
        body: { error: { code: 'TooManyRequests', message: 'Too many requests' } },
        times: 3,
      },
    ]);
    // Scripts match in registration order: the throttled folder first, then a slow Graph for the rest.
    await mock.script('GET /graph/v1.0/me/*', [{ passthrough: true, delay_ms: 120, times: 200 }]);
    const user = await createUser();
    const { accountId } = await connect(user, 'microsoft', ['mail_read']);
    await releaseJobs();
    const started = Date.now();
    await drain({ rounds: 3 });
    const inFlight = await mock.maxInFlight();
    assert((inFlight.graph ?? 0) <= 4, JSON.stringify(inFlight));
    const retry = await q<{ run_after: Date }>(
      `select run_after from public.jobs where connected_account_id = $1 and status = 'retrying'`,
      [accountId],
    );
    assert(
      retry.length >= 1,
      JSON.stringify({
        inFlight,
        jobs: await q(
          `select type, status, attempts, run_after, result, last_error_code from public.jobs where connected_account_id = $1`,
          [accountId],
        ),
        calls: (await mock.requests('/graph/v1.0/me/mailFolders/sentitems')).map((r) => [
          r.seq,
          r.status,
        ]),
      }),
    );
    for (const r of retry)
      assert(new Date(r.run_after).getTime() - started >= 2500, 'Retry-After respected');
  },
);

it(
  'IT-SYNC-16',
  'Google Tasks updatedMin = last − 60 s with date-only due; To Do delta cursor',
  async () => {
    await mock.google({
      op: 'tasks',
      tasks: [
        {
          id: 'taskteklif',
          title: 'Teklif v2 takibi',
          due: '2026-09-28T00:00:00.000Z',
          notes: 'Mehmet Yılmaz',
        },
      ],
    });
    const user = await createUser();
    const accountId = await syncedGoogle(user, ['tasks_read'], { mailbox: [] });
    const task = await one<{ due_date: string | Date | null; due_at: string | null }>(
      `select due_date, due_at from public.tasks where connected_account_id = $1 and provider_task_id = 'taskteklif'`,
      [accountId],
    );
    const due =
      task.due_date instanceof Date
        ? task.due_date
        : new Date(`${String(task.due_date)}T00:00:00Z`);
    assert(
      ['2026-09-28', '2026-09-27'].includes(due.toISOString().slice(0, 10)),
      String(task.due_date),
    );
    assertEquals(task.due_at, null);
    const state = await syncState(accountId, 'google_tasks');
    await manualSync(user, accountId, ['tasks']);
    const polls = (await mock.requests('/tasks/v1/lists/')).filter(
      (r) => r.method === 'GET' && typeof r.query.updatedMin === 'string',
    );
    assert(polls.length >= 1, 'incremental poll with updatedMin');
    assertEquals(
      Date.parse(String(polls[0]?.query.updatedMin)),
      Date.parse(String(state.cursor)) - 60_000,
    );

    await mock.graph({
      op: 'ms_tasks',
      tasks: [{ id: 'AAMkTaskSozlesme', title: 'Sözleşme madde 4', status: 'notStarted' }],
    });
    const other = await createUser();
    const msAccount = await syncedMicrosoft(other, ['tasks_read']);
    const listState = await syncState(msAccount, 'todo_list');
    assert(String(listState.cursor).includes('$deltatoken='), String(listState.cursor));
    assertEquals(
      await count(`select 1 from public.tasks where connected_account_id = $1`, [msAccount]),
      1,
    );
  },
);

it(
  'IT-SYNC-17',
  'device calendar snapshot upserts normalised events with the staleness timestamp',
  async () => {
    const user = await createUser();
    const calendarHash = await sha256Hex('ios-calendar-ev');
    const snapshotAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const body = {
      snapshot_id: crypto.randomUUID(),
      provider: 'apple_device',
      installation_id: crypto.randomUUID(),
      window: { start: isoIn(-2 * 86_400_000), end: isoIn(30 * 86_400_000) },
      snapshot_at: snapshotAt,
      content_hash: await sha256Hex('snapshot-1'),
      calendars: [
        {
          device_calendar_hash: calendarHash,
          title: 'Ev',
          source_title: 'iCloud',
          color: '#34C759',
          allows_modifications: true,
          selected: true,
        },
      ],
      events: [
        {
          event_key_hash: await sha256Hex('doktor'),
          device_calendar_hash: calendarHash,
          title: 'Doktor randevusu',
          start_at: isoIn(26 * HOUR),
          end_at: isoIn(26.5 * HOUR),
          all_day: false,
          location: null,
          attendee_count: 0,
          organizer_is_self: true,
          meeting_url: null,
          status: 'confirmed',
          last_modified_at: null,
        },
      ],
    };
    const res = await call('api', 'POST', '/integrations/device-calendar/snapshot', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body,
    });
    const out = await json<{ data: { connected_account_id: string } }>(res);
    assertEquals(res.status, 202, JSON.stringify(out));
    await releaseJobs();
    await drain();
    const rows = await q<{ title: string; origin: string; device_last_synced_at: Date | null }>(
      `select title, origin, device_last_synced_at from public.calendar_events where connected_account_id = $1`,
      [out.data.connected_account_id],
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.title, 'Doktor randevusu');
    assertEquals(new Date(rows[0]?.device_last_synced_at as Date).toISOString(), snapshotAt);
  },
);

it(
  'IT-SYNC-18',
  'Data Source Controls: mail read off pauses ingestion; attachments off never downloads',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    const acct = await one<{ updated_at: Date }>(
      `select updated_at from public.connected_accounts where id = $1`,
      [accountId],
    );
    const patch = await call('api', 'PATCH', `/integrations/${accountId}/data-sources`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {
        data_sources: { mail_read: false, attachments_analyze: false },
        expected_updated_at: new Date(acct.updated_at).toISOString(),
      },
    });
    assertEquals(patch.status, 200, await patch.text());
    await mock.google({
      op: 'mailbox',
      fixtures: ['gmail/messages_incremental.json'],
      history: true,
    });
    const box = await mailboxState();
    await gmailPush(await accountEmail(accountId), box.history_id).then((r) => r.body?.cancel());
    await releaseJobs();
    await drain();
    assertEquals((await messagesOf(accountId)).length, 5);
    assertEquals((await mock.requests('/gmail/v1/users/me/history')).length, 0);
    assertEquals(
      (await mock.requests('/gmail/v1/users/me/messages/')).filter((r) =>
        r.path.includes('/attachments/'),
      ).length,
      0,
    );
  },
);
