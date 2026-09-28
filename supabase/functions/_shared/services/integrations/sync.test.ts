/**
 * Sync engine over the demo adapters (TEST_PLAN EF-DEMO-01/02, IT-SYNC-*; API_CONTRACTS JOB-01…06,
 * JOB-29): first pass, time-released mail, the poll chain, toggles enforced server-side, demo writes
 * visible after sync, calendar defaults and conference allow-list, date-only tasks, day rollover,
 * device ingest, disconnect → purge, and "no body is persisted or logged".
 */
import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { deriveMarker, ProviderError } from '@da/domain';
import { AppError } from '../../errors.ts';
import { DemoCalendarAdapter } from '../../providers/demo/calendar.ts';
import { DemoMailAdapter } from '../../providers/demo/mail.ts';
import { demoDataset } from '../../providers/demo/fixtures/index.ts';
import { activeDemoAccount, drain, integrationHarness } from '../../testing/integrations.ts';
import { USER_A } from '../../testing/jwt.ts';
import { accountRef } from './context.ts';
import { acceptDeviceSnapshot } from './device.ts';
import { disconnectAccount } from './disconnect.ts';
import { enqueueInitialSync } from './enqueue.ts';
import { updateDataSources } from './controls.ts';
import type { IntegrationHarness } from '../../testing/integrations.ts';
import type { AccountRecord } from './types.ts';

async function firstPass(
  h: IntegrationHarness,
  account: AccountRecord,
  resources: ('mail' | 'calendar' | 'tasks')[] = ['mail', 'calendar', 'tasks'],
) {
  for (const resource of resources) {
    await enqueueInitialSync(h.runtime, account, { resource, phase: 'first_pass', origin: 'test' });
  }
  return await drain(h);
}

function demoCtx(h: IntegrationHarness, account: AccountRecord) {
  return {
    account: accountRef(account),
    tokens: { get: () => Promise.resolve('demo-token') },
    quota: { acquire: () => Promise.resolve() },
    clock: { now: h.runtime.now },
    log: h.runtime.log,
    correlationId: crypto.randomUUID(),
  };
}

Deno.test(
  'demo first pass: mail stored as headers + ≤200-char snippets, triage enqueued, account healthy, poll scheduled',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    await firstPass(h, account, ['mail']);
    const mails = [...h.store.mails.values()];
    assert(mails.length > 50, `stored ${mails.length}`);
    for (const m of mails) {
      assert(m.snippet.length <= 200);
      assert(!('body' in m) && !('body_text' in m) && !('html' in m));
    }
    assert(mails.some((m) => m.from_email === 'ahmet@kuzeylojistik.com'));
    assert(mails.some((m) => m.direction === 'outbound'));
    const triage = [...h.jobs.jobs.values()].filter((j) => j.type === 'email_triage');
    assert(triage.length > 0);
    for (const t of triage)
      assert((t.payload as { email_message_ids: string[] }).email_message_ids.length <= 50);
    assertEquals(h.store.accounts.get(account.id)?.status, 'healthy');
    const state = [...h.store.syncStates.values()].find((s) => s.resource === 'gmail_mailbox');
    assertExists(state?.cursor);
    const polls = [...h.jobs.jobs.values()].filter(
      (j) => j.type === 'gmail_sync' && j.idempotency_key.includes(':poll:'),
    );
    assertEquals(polls.length, 1);
    assert(Date.parse(polls[0]?.run_after ?? '') > h.runtime.now().getTime());
    // No subject or snippet reaches the logs.
    const subject = mails.find((m) => m.subject !== '')?.subject ?? '';
    assert(!h.logLines.some((line) => line.includes(subject)));
    // Demo accounts never get push watches.
    assertEquals([...h.jobs.jobs.values()].filter((j) => j.type === 'watch_renewal').length, 0);
  },
);

Deno.test('demo poll: time-released mail arrives on a later poll, once', async () => {
  const h = await integrationHarness();
  const account = await activeDemoAccount(h, { userId: USER_A });
  await firstPass(h, account, ['mail']);
  const before = h.store.mails.size;
  const later = new Date('2026-09-24T09:30:00.000Z'); // 12:30 Istanbul: includes the 11:05 and 12:20 mails
  const released = demoDataset({
    flavor: 'google',
    timeZone: 'Europe/Istanbul',
    now: later,
  }).mails.filter(
    (m) =>
      Date.parse(m.arriveAt) > Date.parse('2026-09-24T07:30:00.000Z') &&
      Date.parse(m.arriveAt) <= later.getTime(),
  );
  assert(released.some((m) => m.arriveAt === '2026-09-24T08:05:00.000Z'));
  assert(released.some((m) => m.arriveAt === '2026-09-24T09:20:00.000Z'));
  h.setNow(later);
  await drain(h, ['gmail_sync']);
  const after = h.store.mails.size;
  assertEquals(after - before, released.length);
  const triaged = new Set(
    [...h.jobs.jobs.values()]
      .filter((j) => j.type === 'email_triage')
      .flatMap((j) => (j.payload as { email_message_ids: string[] }).email_message_ids),
  );
  assertEquals(triaged.size, after);
  // A second poll at the same instant finds nothing new (the minute of overlap is idempotent).
  await h.runtime.enqueue({
    type: 'gmail_sync',
    idempotencyKey: `gmail_sync:${account.id}:pending:again`,
    payload: { connected_account_id: account.id, trigger: 'manual', target_history_id: null },
    accountId: account.id,
    userId: USER_A,
  });
  await drain(h, ['gmail_sync']);
  assertEquals(h.store.mails.size, after);
  const triagedAgain = [...h.jobs.jobs.values()]
    .filter((j) => j.type === 'email_triage')
    .flatMap((j) => (j.payload as { email_message_ids: string[] }).email_message_ids);
  assertEquals(triagedAgain.length, after);
});

Deno.test(
  'mail_read off → gmail_sync completes {skipped:"paused"}; toggling on starts a sync',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A, toggles: { mail_read: false } });
    await h.runtime.enqueue({
      type: 'gmail_sync',
      idempotencyKey: `gmail_sync:${account.id}:pending`,
      payload: { connected_account_id: account.id, trigger: 'manual', target_history_id: null },
      accountId: account.id,
      userId: USER_A,
    });
    await drain(h, ['gmail_sync']);
    const job = [...h.jobs.jobs.values()].find((j) => j.type === 'gmail_sync');
    assertEquals(job?.status, 'completed');
    assertEquals(job?.result, { skipped: 'paused' });
    assertEquals(h.store.mails.size, 0);

    const current = h.store.accounts.get(account.id)!;
    const out = await updateDataSources(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      dataSources: { mail_read: true },
      expectedUpdatedAt: current.updated_at,
      correlationId: crypto.randomUUID(),
    });
    assert(out.consequences.includes('sync_started'));
    assertEquals(out.account.data_sources.mail_read, true);
    await drain(h);
    assert(h.store.mails.size > 0);
  },
);

Deno.test(
  'data sources: optimistic concurrency, calendar plan limit (402) and deselect → channel stop',
  async () => {
    const h = await integrationHarness();
    h.store.planLimits.set(`${USER_A}:max_calendars`, 1);
    const account = await activeDemoAccount(h, { userId: USER_A });
    await firstPass(h, account, ['calendar']);
    const calendars = [...h.store.calendars.values()];
    assertEquals(calendars.filter((c) => c.selected).length, 1);
    assertEquals(calendars.find((c) => c.selected)?.is_primary, true);
    await assertRejects(
      () =>
        updateDataSources(h.runtime, {
          userId: USER_A,
          accountId: account.id,
          dataSources: { draft_replies: false },
          expectedUpdatedAt: '2020-01-01T00:00:00Z',
          correlationId: 'c',
        }),
      AppError,
      'STATE_CONFLICT',
    );
    const other = calendars.find((c) => !c.selected)!;
    const err = await assertRejects(
      () =>
        updateDataSources(h.runtime, {
          userId: USER_A,
          accountId: account.id,
          calendars: [{ calendar_id: other.id, selected: true }],
          expectedUpdatedAt: h.store.accounts.get(account.id)!.updated_at,
          correlationId: 'c',
        }),
      AppError,
    );
    assertEquals(err.code, 'ENTITLEMENT_REQUIRED');
    assertEquals(err.details, { feature: 'calendars', limit: 1, current: 1 });
    const primary = calendars.find((c) => c.selected)!;
    const swapped = await updateDataSources(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      calendars: [
        { calendar_id: primary.id, selected: false },
        { calendar_id: other.id, selected: true },
      ],
      defaultWriteCalendarId: other.id,
      expectedUpdatedAt: h.store.accounts.get(account.id)!.updated_at,
      correlationId: 'c',
    });
    assertEquals(swapped.calendars.find((c) => c.id === other.id)?.is_default_write, true);
    assert(swapped.consequences.includes('calendar_events_hidden'));
    assert(h.audit.some((a) => a.action === 'user.integration.data_sources_updated'));
  },
);

Deno.test(
  'demo calendar: events with the allow-listed Meet link, a created event appears after sync (M§100)',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    await firstPass(h, account, ['calendar']);
    const events = [...h.store.events.values()];
    const meeting = events.find((e) => e.title === 'Mehmet ile müşteri toplantısı');
    assertExists(meeting);
    assert(meeting.conference_url?.startsWith('https://meet.google.com/'));
    assert(events.some((e) => e.title === 'Doktor randevusu'));

    const adapter = new DemoCalendarAdapter({
      store: h.store,
      timeZone: () => Promise.resolve('Europe/Istanbul'),
    });
    const approvalId = crypto.randomUUID();
    const marker = await deriveMarker(approvalId, `approval:${approvalId}`, {
      mailDomain: 'mail.example.test',
      webUrl: 'https://example.test',
    });
    const spec = {
      providerCalendarId: 'demo-cal-kisisel',
      title: 'Teklif hazırla',
      description: null,
      start: { dateTime: '2026-09-24T11:00:00.000Z', timeZone: 'Europe/Istanbul' },
      end: { dateTime: '2026-09-24T13:30:00.000Z', timeZone: 'Europe/Istanbul' },
      location: null,
      attendees: [],
      sendUpdates: 'none' as const,
      reminderMinutes: [],
      marker,
    };
    const ctx = demoCtx(h, h.store.accounts.get(account.id)!);
    const created = await adapter.createEvent(ctx, spec);
    assertEquals(created.kind, 'created');
    const again = await adapter.createEvent(ctx, spec);
    assertEquals(again.kind, 'already_exists');
    assertEquals(
      (await adapter.findEventByMarker(ctx, 'demo-cal-kisisel', marker))?.providerId,
      created.providerId,
    );
    await h.runtime.enqueue({
      type: 'calendar_sync',
      idempotencyKey: `calendar_sync:${account.id}:all:pending`,
      payload: { connected_account_id: account.id, calendar_id: null, trigger: 'post_write' },
      accountId: account.id,
      userId: USER_A,
    });
    await drain(h, ['calendar_sync']);
    const stored = [...h.store.events.values()].find(
      (e) => e.provider_event_id === created.providerId,
    );
    assertEquals(stored?.title, 'Teklif hazırla');
    assertEquals(stored?.da_approval_id, approvalId);

    // A stale etag is refused; the right one updates in place.
    await assertRejects(
      () =>
        adapter.updateEvent(ctx, {
          providerCalendarId: 'demo-cal-kisisel',
          providerEventId: created.providerId,
          expectedEtag: '"stale"',
          sendUpdates: 'none',
          title: 'x',
          marker: { ...marker, approvalId: crypto.randomUUID() },
        }),
      ProviderError,
    );
  },
);

Deno.test("demo calendar day rollover retires the previous day's meetings", async () => {
  const h = await integrationHarness();
  const account = await activeDemoAccount(h, { userId: USER_A });
  await firstPass(h, account, ['calendar']);
  const day1 = [...h.store.events.values()]
    .filter((e) => e.provider_event_id.startsWith('demo:mehmet-musteri:'))
    .map((e) => e.provider_event_id);
  assertEquals(day1, ['demo:mehmet-musteri:20260924']);
  h.setNow(new Date('2026-09-25T07:30:00.000Z'));
  await h.runtime.enqueue({
    type: 'calendar_sync',
    idempotencyKey: `calendar_sync:${account.id}:all:pending:2`,
    payload: { connected_account_id: account.id, calendar_id: null, trigger: 'poll' },
    accountId: account.id,
    userId: USER_A,
  });
  await drain(h, ['calendar_sync']);
  const live = [...h.store.events.values()].filter(
    (e) => e.provider_event_id.startsWith('demo:mehmet-musteri:') && e.provider_deleted_at === null,
  );
  assertEquals(
    live.map((e) => e.provider_event_id),
    ['demo:mehmet-musteri:20260925'],
  );
});

Deno.test('demo tasks: "Görevlerim" with a date-only due date', async () => {
  const h = await integrationHarness();
  const account = await activeDemoAccount(h, { userId: USER_A });
  await firstPass(h, account, ['tasks']);
  const tasks = [...h.store.tasks.values()];
  assertEquals(tasks.length, 3);
  const due = tasks.find((t) => t.provider_task_id.startsWith('demo:teklif-v2-gonder'));
  assertEquals(due?.due_date, '2026-09-24');
  assertEquals(due?.due_at, null);
});

Deno.test(
  'demo reply write is recorded once and appears as a sent message in its thread',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    await firstPass(h, account, ['mail']);
    const inbound = [...h.store.mails.values()].find(
      (m) => m.from_email === 'ahmet@kuzeylojistik.com',
    )!;
    const adapter = new DemoMailAdapter({
      store: h.store,
      timeZone: () => Promise.resolve('Europe/Istanbul'),
    });
    const approvalId = crypto.randomUUID();
    const marker = await deriveMarker(approvalId, `approval:${approvalId}`, {
      mailDomain: 'mail.example.test',
      webUrl: 'https://example.test',
    });
    const reply = {
      inReplyToProviderMessageId: inbound.provider_message_id,
      providerThreadId: inbound.provider_thread_id,
      originalRfc822MessageId: inbound.internet_message_id,
      originalReferences: [],
      from: { address: 'yunus@gmail.com', name: 'Yunus' },
      to: [{ address: 'ahmet@kuzeylojistik.com', name: 'Ahmet Yılmaz' }],
      cc: [],
      subject: `Re: ${inbound.subject}`,
      bodyText: 'Teşekkürler Ahmet Bey, revize teklifi bugün inceleyip dönüş yapacağım.',
      marker,
    };
    const ctx = demoCtx(h, h.store.accounts.get(account.id)!);
    assertEquals((await adapter.sendReply(ctx, reply)).kind, 'created');
    assertEquals((await adapter.sendReply(ctx, reply)).kind, 'already_exists');
    assertExists(await adapter.findSentByMarker(ctx, marker));
    h.setNow(new Date(h.runtime.now().getTime() + 60_000));
    await h.runtime.enqueue({
      type: 'gmail_sync',
      idempotencyKey: `gmail_sync:${account.id}:pending:x`,
      payload: { connected_account_id: account.id, trigger: 'manual', target_history_id: null },
      accountId: account.id,
      userId: USER_A,
    });
    await drain(h, ['gmail_sync']);
    const sent = [...h.store.mails.values()].find(
      (m) => m.provider_message_id === `demo:reply:${approvalId}`,
    );
    assertEquals(sent?.direction, 'outbound');
    assertEquals(sent?.provider_thread_id, inbound.provider_thread_id);
  },
);

Deno.test(
  'device snapshot: identical hash dedupes, unselected / over-limit calendars dropped, meeting URL allow-listed',
  async () => {
    const h = await integrationHarness();
    h.store.planLimits.set(`${USER_A}:max_calendars`, 1);
    const hash = (c: string) => c.repeat(64);
    const snapshot = {
      snapshot_id: crypto.randomUUID(),
      provider: 'apple_device' as const,
      installation_id: crypto.randomUUID(),
      window: { start: '2026-09-23T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' },
      snapshot_at: '2026-09-24T07:30:00.000Z',
      content_hash: hash('a'),
      calendars: [
        {
          device_calendar_hash: hash('1'),
          title: 'Takvim',
          source_title: 'iCloud',
          color: '#00AAFF',
          allows_modifications: true,
          selected: true,
        },
        {
          device_calendar_hash: hash('2'),
          title: 'İş',
          source_title: 'iCloud',
          color: null,
          allows_modifications: true,
          selected: true,
        },
        {
          device_calendar_hash: hash('3'),
          title: 'Doğum günleri',
          source_title: 'iCloud',
          color: null,
          allows_modifications: false,
          selected: false,
        },
      ],
      events: [
        {
          event_key_hash: hash('e'),
          device_calendar_hash: hash('1'),
          title: 'Toplantı',
          start_at: '2026-09-24T09:00:00.000Z',
          end_at: '2026-09-24T10:00:00.000Z',
          all_day: false,
          location: null,
          attendee_count: 2,
          organizer_is_self: true,
          meeting_url: 'https://evil.example.com/join',
          status: 'confirmed' as const,
          last_modified_at: null,
        },
        {
          event_key_hash: hash('f'),
          device_calendar_hash: hash('1'),
          title: 'Meet',
          start_at: '2026-09-24T11:00:00.000Z',
          end_at: '2026-09-24T12:00:00.000Z',
          all_day: false,
          location: null,
          attendee_count: 2,
          organizer_is_self: true,
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          status: 'confirmed' as const,
          last_modified_at: null,
        },
        {
          event_key_hash: hash('9'),
          device_calendar_hash: hash('2'),
          title: 'Over limit',
          start_at: '2026-09-24T13:00:00.000Z',
          end_at: '2026-09-24T14:00:00.000Z',
          all_day: false,
          location: null,
          attendee_count: 0,
          organizer_is_self: null,
          meeting_url: null,
          status: 'confirmed' as const,
          last_modified_at: null,
        },
      ],
    };
    const first = await acceptDeviceSnapshot(h.runtime, {
      userId: USER_A,
      snapshot,
      correlationId: 'c',
    });
    const second = await acceptDeviceSnapshot(h.runtime, {
      userId: USER_A,
      snapshot,
      correlationId: 'c',
    });
    assertEquals(first.job.job_id, second.job.job_id);
    assertEquals(first.connected_account_id, second.connected_account_id);
    assertEquals(h.audit.filter((a) => a.action === 'user.integration.connected').length, 1);
    await drain(h, ['device_calendar_ingest']);
    const events = [...h.store.events.values()];
    assertEquals(events.map((e) => e.title).sort(), ['Meet', 'Toplantı']);
    assertEquals(events.find((e) => e.title === 'Toplantı')?.conference_url, null);
    assertEquals(
      events.find((e) => e.title === 'Meet')?.conference_url,
      'https://meet.google.com/abc-defg-hij',
    );
  },
);

Deno.test(
  'disconnect: credentials deleted, queued syncs cancelled, purge now with purge_content; purge removes only that account',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    const other = await activeDemoAccount(h, { userId: USER_A, flavor: 'microsoft' });
    await firstPass(h, account, ['mail', 'tasks']);
    await firstPass(h, other, ['tasks']);
    const otherTasks = [...h.store.tasks.values()].filter((t) => t.account_id === other.id).length;
    await h.runtime.enqueue({
      type: 'gmail_sync',
      idempotencyKey: `gmail_sync:${account.id}:pending:q`,
      payload: { connected_account_id: account.id, trigger: 'manual', target_history_id: null },
      accountId: account.id,
      userId: USER_A,
    });
    const out = await disconnectAccount(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      purgeContent: true,
      correlationId: crypto.randomUUID(),
      log: h.runtime.log,
    });
    assertEquals(out.revocation, 'provider_revoked');
    assertEquals(out.account.status, 'disconnected');
    assertEquals(out.manual_revoke_url, null);
    assertEquals(h.store.credentials.has(`${account.id}:refresh`), false);
    assertEquals(
      [...h.jobs.jobs.values()].find(
        (j) => j.idempotency_key === `gmail_sync:${account.id}:pending:q`,
      )?.last_error_code,
      'CANCELLED',
    );
    const again = await disconnectAccount(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      purgeContent: true,
      correlationId: crypto.randomUUID(),
      log: h.runtime.log,
    });
    assertEquals(again.purge_job.job_id, out.purge_job.job_id);
    assertEquals(h.audit.filter((a) => a.action === 'user.integration.disconnected').length, 1);
    await drain(h, ['integration_purge']);
    assertEquals(h.store.accounts.has(account.id), false);
    assertEquals([...h.store.mails.values()].filter((m) => m.account_id === account.id).length, 0);
    assertEquals(
      [...h.store.tasks.values()].filter((t) => t.account_id === other.id).length,
      otherTasks,
    );
    assert(h.audit.some((a) => a.action === 'system.integration.purged'));
  },
);

Deno.test(
  'disconnect without purge_content schedules the purge 30 days out; a reconnect first cancels it',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    const out = await disconnectAccount(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      purgeContent: false,
      correlationId: crypto.randomUUID(),
      log: h.runtime.log,
    });
    const job = h.jobs.jobs.get(out.purge_job.job_id)!;
    assertEquals(Date.parse(job.run_after) - h.runtime.now().getTime(), 30 * 86_400_000);
    h.store.accounts.get(account.id)!.status = 'healthy';
    h.setNow(new Date(Date.parse(job.run_after) + 1000));
    await drain(h, ['integration_purge']);
    assertEquals(h.jobs.jobs.get(job.id)?.result, { skipped: 'reconnected' });
    assertEquals(h.store.accounts.has(account.id), true);
  },
);

Deno.test(
  'Gmail history 404 seen by a push and a poll sync queues one bounded resync (IT-SYNC-03 dedupe)',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER_A });
    await firstPass(h, account, ['mail']);
    const original = DemoMailAdapter.prototype.changesSince;
    DemoMailAdapter.prototype.changesSince = () =>
      Promise.reject(new ProviderError('cursor_invalid', 404, null, 'notFound'));
    try {
      // The provider_webhook job enqueues a push sync; the scheduler's poll runs a second later.
      for (const [trigger, offset] of [
        ['push', 1_000],
        ['poll', 2_000],
      ] as const) {
        h.setNow(new Date(Date.parse('2026-09-24T07:30:00.000Z') + offset));
        await h.runtime.enqueue({
          type: 'gmail_sync',
          idempotencyKey: `gmail_sync:${account.id}:${trigger}:404`,
          payload: { connected_account_id: account.id, trigger, target_history_id: null },
          accountId: account.id,
          userId: USER_A,
        });
        await drain(h, ['gmail_sync']);
      }
    } finally {
      DemoMailAdapter.prototype.changesSince = original;
    }
    const resyncs = [...h.jobs.jobs.values()].filter(
      (j) => j.type === 'initial_sync' && (j.payload as { phase?: string }).phase === 'resync',
    );
    assertEquals(resyncs.length, 1);
    // The key is derived from the hashed stale cursor, which also fits the payload's `origin`.
    assert(
      /^resync:[0-9a-f-]{36}:[0-9a-f]{40}$/.test(
        (resyncs[0]!.payload as { origin: string }).origin,
      ),
    );
    const states = [...h.store.syncStates.values()].filter(
      (s) => s.connected_account_id === account.id && s.status === 'resync_required',
    );
    assertEquals(states.length, 1);
  },
);
