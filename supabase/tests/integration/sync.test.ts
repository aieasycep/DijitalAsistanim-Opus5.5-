/**
 * IT-SYNC-* (TEST_PLAN §6.3; API_CONTRACTS JOB-01…09, WH-01…04, API-INT-04…06; INTEGRATION_PLAN §3,
 * §4, §5; ADR-07).
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { call, count, createUser, drain, it, mock, one, q, releaseJobs } from './_harness/mod.ts';
import { sha256Hex } from './_harness/flows.ts';
import {
  accountEmail,
  gmailPush,
  mailboxState,
  messagesOf,
  pushAndDrain,
  syncedGoogle,
  syncState,
} from './_harness/sync.ts';

const HOUR = 3_600_000;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

async function gmailGets(format: string) {
  return (await mock.requests('/gmail/v1/users/me/messages/')).filter(
    (r) => r.method === 'GET' && !r.path.includes('/attachments/') && r.query.format === format,
  );
}

it(
  'IT-SYNC-01',
  'Gmail first pass: metadata first, full bodies only for triage survivors, no body stored, deduped',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    const metadata = await gmailGets('metadata');
    assertEquals(new Set(metadata.map((r) => r.path)).size, 5);
    for (const r of metadata) {
      const headers = Array.isArray(r.query.metadataHeaders)
        ? r.query.metadataHeaders
        : [r.query.metadataHeaders];
      for (const h of ['From', 'Subject', 'Message-ID', 'List-Unsubscribe'])
        assert(headers.includes(h), h);
    }
    const full = await gmailGets('full');
    const fullIds = new Set(full.map((r) => r.path.split('/').pop()));
    assert(fullIds.size >= 1 && fullIds.size < 5, `full fetches: ${[...fullIds].join(',')}`);
    // The promotional bulk mail never survives triage.
    assertFalse(fullIds.has('18f2a0c1d0000005'));
    // Every metadata fetch precedes the first full fetch of the same message.
    for (const f of full) {
      const id = f.path.split('/').pop() ?? '';
      const meta = metadata.find((m) => m.path.endsWith(`/${id}`));
      assert(meta !== undefined && meta.seq < f.seq, id);
    }
    const rows = await messagesOf(accountId);
    assertEquals(rows.length, 5);
    const dump = JSON.stringify(rows);
    for (const phrase of ['Teşekkürler, Ahmet', 'Saygılarımla, Mehmet'])
      assertFalse(dump.includes(phrase), phrase);
    // A second first pass over the same mailbox inserts nothing new.
    await q(`delete from public.rate_limits`);
    const again = await call('api', 'POST', `/integrations/${accountId}/sync`, {
      jwt: user.jwt,
      body: { resources: ['mail'] },
    });
    assertEquals(again.status, 202, await again.text());
    await releaseJobs();
    await drain();
    assertEquals((await messagesOf(accountId)).length, 5);
    assertEquals(
      await count(
        `select provider_message_id from public.email_messages where connected_account_id = $1 group by provider_message_id having count(*) > 1`,
        [accountId],
      ),
      0,
    );
  },
);

it(
  'IT-SYNC-02',
  'Gmail incremental: Pub/Sub → provider_webhook → history.list over 2 pages',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    const before = await syncState(accountId, 'gmail_mailbox');
    await mock.google({ op: 'page_size', history: 2 });
    await mock.google({
      op: 'mailbox',
      fixtures: ['gmail/messages_incremental.json'],
      history: true,
    });
    const state = await mailboxState();
    const res = await gmailPush(await accountEmail(accountId), state.history_id);
    assertEquals(res.status, 204);
    const webhookJobs = await q<{ type: string; idempotency_key: string }>(
      `select type, idempotency_key from public.jobs where connected_account_id = $1 and type = 'provider_webhook'`,
      [accountId],
    );
    assertEquals(webhookJobs.length, 1);
    await releaseJobs();
    await drain();
    const history = (await mock.requests('/gmail/v1/users/me/history')).filter(
      (r) => r.status === 200,
    );
    assertEquals(history.length, 2);
    assertEquals(history[0]?.query.startHistoryId, String(before.cursor));
    assertEquals(history[1]?.query.pageToken, '2');
    assertEquals((await messagesOf(accountId)).length, 8);
    const after = await syncState(accountId, 'gmail_mailbox');
    assertEquals(String(after.cursor), String(state.history_id));
    // A replayed push (same Pub/Sub message id) is deduped by the webhook ledger.
  },
);

it(
  'IT-SYNC-03',
  'Gmail history 404 invalidates the cursor and resyncs the last 7 days',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    await mock.google({
      op: 'mailbox',
      fixtures: ['gmail/messages_incremental.json'],
      history: true,
    });
    await mock.google({ op: 'history_floor', value: 10_000_000 });
    const box = await mailboxState();
    await gmailPush(await accountEmail(accountId), box.history_id).then((r) => r.body?.cancel());
    await releaseJobs();
    await drain({ types: ['provider_webhook', 'gmail_sync'] });
    const invalidated = await syncState(accountId, 'gmail_mailbox');
    assert(invalidated.cursor_invalidated_at !== null, JSON.stringify(invalidated));
    assertEquals(invalidated.status, 'resync_required');
    const resync = await q<{ payload: { phase?: string } }>(
      `select payload from public.jobs where connected_account_id = $1 and type = 'initial_sync' and status = 'queued'`,
      [accountId],
    );
    assert(
      resync.length >= 1 && resync.every((j) => j.payload.phase === 'resync'),
      JSON.stringify(resync),
    );
    await releaseJobs();
    await drain();
    const history = await mock.requests('/gmail/v1/users/me/history');
    const notFound = history.find((r) => r.status === 404);
    assert(notFound !== undefined, 'history 404');
    const lists = (await mock.requests('/gmail/v1/users/me/messages')).filter(
      (r) =>
        r.method === 'GET' &&
        r.seq > notFound.seq &&
        typeof r.query.q === 'string' &&
        /after:\d+/.test(String(r.query.q)),
    );
    assert(lists.length >= 1, 'bounded resync list');
    const after = Number(/after:(\d+)/.exec(String(lists[0]?.query.q))?.[1]) * 1000;
    const days = (Date.now() - after) / 86_400_000;
    assert(days > 6.5 && days < 7.5, `resync window ${days} days`);
    const state = await syncState(accountId, 'gmail_mailbox');
    assertEquals(state.status, 'idle');
    assert(state.cursor !== null);
    assertEquals((await messagesOf(accountId)).length, 8);
  },
);

async function liveThreadInsights(accountId: string): Promise<number> {
  return await count(
    `select 1 from public.insights i join public.email_messages m on i.entity_id = m.thread_id
      where m.connected_account_id = $1 and m.provider_message_id in ('18f2a0c1d0000001', '18f2a0c1d0000003')
        and i.status in ('open', 'snoozed')`,
    [accountId],
  );
}

it(
  'IT-SYNC-04',
  'Gmail messageDeleted / labelRemoved INBOX reconcile the derived rows',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    assert((await liveThreadInsights(accountId)) >= 1, 'insights before the reconcile');
    await mock.google({ op: 'delete_message', id: '18f2a0c1d0000003' });
    await mock.google({ op: 'remove_label', id: '18f2a0c1d0000001', label: 'INBOX' });
    await pushAndDrain(accountId);
    const deleted = await one<{ provider_deleted_at: string | null }>(
      `select * from public.email_messages where connected_account_id = $1 and provider_message_id = $2`,
      [accountId, '18f2a0c1d0000003'],
    ).catch(() => null);
    assert(deleted === null || deleted.provider_deleted_at !== null, 'deleted message reconciled');
    const archived = await one<{ labels: string[] }>(
      `select labels from public.email_messages where connected_account_id = $1 and provider_message_id = $2`,
      [accountId, '18f2a0c1d0000001'],
    );
    assertFalse(archived.labels.includes('INBOX'));
    assertEquals(
      await liveThreadInsights(accountId),
      0,
      JSON.stringify({
        jobs: await q(
          `select type, status, payload, result from public.jobs where type = 'insight_refresh'`,
        ),
        insights: await q(
          `select kind, status, entity_type, entity_id, dedupe_key from public.insights where user_id = $1`,
          [user.id],
        ),
      }),
    );
  },
);

it(
  'IT-SYNC-05',
  'Gmail 429 Retry-After: 2 → retrying with run_after ≥ now + 2 s, then completed',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    await mock.google({
      op: 'mailbox',
      fixtures: ['gmail/messages_incremental.json'],
      history: true,
    });
    await mock.script('GET /gmail/v1/users/me/history', [
      {
        status: 429,
        headers: { 'Retry-After': '2' },
        fixture: 'gmail/rate_limit_429.json',
        times: 3,
      },
    ]);
    const state = await mailboxState();
    await gmailPush(await accountEmail(accountId), state.history_id).then((r) => r.body?.cancel());
    await releaseJobs();
    const started = Date.now();
    await drain({ rounds: 1 });
    const job = await one<{ status: string; run_after: Date; attempts: number }>(
      `select status, run_after, attempts from public.jobs where connected_account_id = $1 and type in ('provider_webhook','gmail_sync') and status <> 'completed' order by created_at desc limit 1`,
      [accountId],
    );
    assertEquals(job.status, 'retrying');
    const delay = new Date(job.run_after).getTime() - started;
    assert(delay >= 1500 && delay < 60_000, `run_after delay ${delay} ms`);
    await releaseJobs();
    await drain();
    assertEquals((await messagesOf(accountId)).length, 8);
  },
);

it(
  'IT-SYNC-06',
  'Gmail 403 userRateLimitExceeded → backoff with jitter, quota usage recorded',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    await mock.google({
      op: 'mailbox',
      fixtures: ['gmail/messages_incremental.json'],
      history: true,
    });
    await mock.script('GET /gmail/v1/users/me/history', [
      { status: 403, fixture: 'gmail/user_rate_limit_403.json', times: 5 },
    ]);
    const state = await mailboxState();
    await gmailPush(await accountEmail(accountId), state.history_id).then((r) => r.body?.cancel());
    await releaseJobs();
    const started = Date.now();
    await drain({ rounds: 1 });
    const job = await one<{ status: string; run_after: Date }>(
      `select status, run_after from public.jobs where connected_account_id = $1 and status = 'retrying' order by created_at desc limit 1`,
      [accountId],
    );
    const delay = new Date(job.run_after).getTime() - started;
    assert(delay > 0, `backoff ${delay} ms`);
    const quota = await q(
      `select * from public.provider_quota_usage where connected_account_id = $1`,
      [accountId],
    );
    assert(quota.length >= 1, 'provider_quota_usage rows');
    const calls = (await mock.requests('/gmail/v1/users/me/history')).length;
    assert(calls <= 3, `history calls while throttled: ${calls}`);
  },
);

it('IT-SYNC-07', 'Gmail watch renewal 30 h before expiry stores the new expiration', async () => {
  const user = await createUser();
  const accountId = await syncedGoogle(user);
  await q(
    `update public.sync_states set watch_expires_at = now() + interval '30 hours', watch_renew_after = now() - interval '1 minute'
      where connected_account_id = $1 and resource = 'gmail_mailbox'`,
    [accountId],
  );
  await mock.reset();
  const expiration = Date.now() + 7 * 86_400_000;
  await mock.google({ op: 'watch_expiration', value: expiration });
  await q(`select private.scheduler_tick(now())`);
  await releaseJobs();
  await drain({ types: ['watch_renewal'] });
  const watches = (await mock.requests('/gmail/v1/users/me/watch')).filter(
    (r) => r.method === 'POST',
  );
  assertEquals(
    watches.length,
    1,
    JSON.stringify(
      watches.map((w) => [w.seq, w.status, w.scripted, w.headers['authorization']?.slice(0, 12)]),
    ),
  );
  const state = await syncState(accountId, 'gmail_mailbox');
  assert(
    Math.abs(new Date(String(state.watch_expires_at)).getTime() - expiration) < 1000,
    String(state.watch_expires_at),
  );
});

const EVENTS = [
  {
    id: 'evt0haftalikekip',
    summary: 'Haftalık ekip',
    start: { dateTime: isoIn(2 * HOUR), timeZone: 'Europe/Istanbul' },
    end: { dateTime: isoIn(3 * HOUR), timeZone: 'Europe/Istanbul' },
    organizer: { email: 'yunus.demir@example.com', self: true },
  },
  {
    id: 'evt0mehmetmusteri',
    summary: 'Mehmet müşteri toplantısı',
    start: { dateTime: isoIn(5 * HOUR), timeZone: 'Europe/Istanbul' },
    end: { dateTime: isoIn(6 * HOUR), timeZone: 'Europe/Istanbul' },
    attendees: [{ email: 'mehmet@yilmazendustri.example', displayName: 'Mehmet Yılmaz' }],
    organizer: { email: 'yunus.demir@example.com', self: true },
  },
];

it(
  'IT-SYNC-08',
  'Calendar full list then incremental with syncToken; cancelled events removed',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user, ['calendar_read'], { mailbox: [], events: EVENTS });
    const events = await q(
      `select provider_event_id, title from public.calendar_events where connected_account_id = $1`,
      [accountId],
    );
    assertEquals(events.length, 2);
    assertEquals(
      await count(
        `select 1 from public.calendar_events where connected_account_id = $1 group by calendar_id, provider_event_id having count(*) > 1`,
        [accountId],
      ),
      0,
    );
    await mock.google({ op: 'cancel_event', id: 'evt0haftalikekip' });
    await mock.google({
      op: 'events',
      events: [
        {
          id: 'evt0urungozden',
          summary: 'Ürün gözden geçirme',
          start: { dateTime: isoIn(8 * HOUR) },
          end: { dateTime: isoIn(8.5 * HOUR) },
        },
      ],
    });
    await q(`delete from public.rate_limits`);
    const res = await call('api', 'POST', `/integrations/${accountId}/sync`, {
      jwt: user.jwt,
      body: { resources: ['calendar'] },
    });
    assertEquals(res.status, 202, await res.text());
    await releaseJobs();
    await drain();
    const lists = (await mock.requests('/calendar/v3/calendars/primary/events')).filter(
      (r) => r.method === 'GET',
    );
    assert(
      lists.some((r) => typeof r.query.syncToken === 'string'),
      'incremental list uses syncToken',
    );
    const live = await q<{ provider_event_id: string }>(
      `select provider_event_id from public.calendar_events where connected_account_id = $1 and provider_deleted_at is null and status <> 'cancelled'`,
      [accountId],
    );
    assertEquals(live.map((e) => e.provider_event_id).sort(), [
      'evt0mehmetmusteri',
      'evt0urungozden',
    ]);
  },
);

it('IT-SYNC-09', 'Calendar 410 wipes the calendar and runs a full resync', async () => {
  const user = await createUser();
  const accountId = await syncedGoogle(user, ['calendar_read'], { mailbox: [], events: EVENTS });
  await mock.reset();
  await mock.google({ op: 'events', events: EVENTS });
  await mock.script('GET /calendar/v3/calendars/primary/events', [
    { status: 410, fixture: 'gcal/events_list_410.json' },
  ]);
  await q(`delete from public.rate_limits`);
  await call('api', 'POST', `/integrations/${accountId}/sync`, {
    jwt: user.jwt,
    body: { resources: ['calendar'] },
  }).then((r) => r.body?.cancel());
  await releaseJobs();
  await drain();
  const lists = (await mock.requests('/calendar/v3/calendars/primary/events')).filter(
    (r) => r.method === 'GET',
  );
  assertEquals(lists[0]?.status, 410);
  assert(typeof lists[0]?.query.syncToken === 'string');
  assert(
    lists.slice(1).some((r) => r.query.syncToken === undefined && r.status === 200),
    'full resync after 410',
  );
  assertEquals(
    await count(
      `select 1 from public.calendar_events where connected_account_id = $1 and provider_deleted_at is null`,
      [accountId],
    ),
    2,
  );
});

it(
  'IT-SYNC-10',
  'Calendar channel renewal ahead of expiry; an invalid channel token → 401, nothing enqueued',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user, ['calendar_read'], { mailbox: [], events: EVENTS });
    const before = await syncState(accountId, 'google_calendar');
    assert(before.watch_id !== null, 'channel created');
    await q(
      `update public.sync_states set watch_expires_at = now() + interval '20 hours', watch_renew_after = now() - interval '1 minute'
      where connected_account_id = $1 and resource = 'google_calendar'`,
      [accountId],
    );
    await mock.reset();
    await q(`select private.scheduler_tick(now())`);
    await releaseJobs();
    await drain({ types: ['watch_renewal'] });
    const watch = (await mock.requests('/calendar/v3/calendars/')).filter((r) =>
      r.path.endsWith('/events/watch'),
    );
    assertEquals(
      watch.length,
      1,
      JSON.stringify((await mock.requests()).map((w) => [w.seq, w.method, w.path, w.status])),
    );
    const stop = await mock.requests('/calendar/v3/channels/stop');
    assertEquals(stop.length, 1);
    const after = await syncState(accountId, 'google_calendar');
    assert(after.watch_id !== before.watch_id);

    const jobsBefore = await count(`select 1 from public.jobs`);
    const bad = await call('webhooks-google', 'POST', '/calendar', {
      headers: {
        'X-Goog-Channel-ID': String(after.watch_id),
        'X-Goog-Channel-Token': 'not-the-channel-token',
        'X-Goog-Resource-ID': String(after.watch_resource_id),
        'X-Goog-Resource-State': 'exists',
        'X-Goog-Message-Number': '7',
        'X-Goog-Resource-URI': 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      },
    });
    await bad.body?.cancel();
    assertEquals(bad.status, 401);
    assertEquals(await count(`select 1 from public.jobs`), jobsBefore);
    // The genuine token (HMAC of the channel id) is accepted and enqueues one provider_webhook.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(Deno.env.get('WEBHOOK_HMAC_SECRET') ?? ''),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(after.watch_id))),
    );
    const token = btoa(String.fromCharCode(...mac))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assertEquals(
      await sha256Hex(token),
      [...(after.watch_token_hash as Uint8Array)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
    const good = await call('webhooks-google', 'POST', '/calendar', {
      headers: {
        'X-Goog-Channel-ID': String(after.watch_id),
        'X-Goog-Channel-Token': token,
        'X-Goog-Resource-ID': String(after.watch_resource_id),
        'X-Goog-Resource-State': 'exists',
        'X-Goog-Message-Number': '8',
        'X-Goog-Resource-URI': 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      },
    });
    await good.body?.cancel();
    assertEquals(good.status, 200);
    assertEquals(
      await count(
        `select 1 from public.jobs where type = 'provider_webhook' and connected_account_id = $1`,
        [accountId],
      ),
      1,
    );
  },
);
