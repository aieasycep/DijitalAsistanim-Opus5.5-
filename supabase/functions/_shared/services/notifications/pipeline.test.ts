/**
 * JOB-18 / JOB-19 with an Expo stub (UT-NTF-02/04/05/09/10/11/12/16/17, IT-NTF-01..07, EF-NTF-01):
 * decision → ledger row → render → Expo send (≤ 100 per request, bearer token, gzip) → tickets →
 * receipts. Times: 2026-09-23 is a Wednesday; Europe/Istanbul is UTC+3.
 */
import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { routes, toDeepLink } from '@da/domain';
import { JobError } from '../../jobs/types.ts';
import { jsonResponse, type RecordedCall, stubFetch } from '../../testing/fetch.ts';
import { USER_A } from '../../testing/jwt.ts';
import { jobContext, memoryNotifications, memoryQueue } from '../../testing/workflows.ts';
import { NotificationJobPayload } from './create.ts';
import { createExpoPushClient, type ExpoMessage } from './expo-push.ts';
import { processNotification, receiptsJobKey } from './pipeline.ts';
import { processPushReceipts, type PushReceiptsPayload } from './receipts.ts';
import type {
  ApprovalInfo,
  BriefingInfo,
  EventInfo,
  InsightInfo,
  ReminderInfo,
  SubscriptionInfo,
  TriggerRepo,
} from './triggers/types.ts';

const TOKEN = 'expo-access-token-test';
const THREAD = '99999999-9999-4999-8999-999999999999';
const DAY = new Date('2026-09-23T09:00:00.000Z'); // 12:00 local
const QUIET = new Date('2026-09-23T20:10:00.000Z'); // 23:10 local
const QUIET_END = '2026-09-24T04:30:00.000Z'; // 07:30 local

async function bodyOf(call: RecordedCall): Promise<unknown> {
  if (call.headers.get('Content-Encoding') === 'gzip') {
    const stream = new Blob([call.rawBody as Uint8Array])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(call.body ?? 'null');
}

function memoryTriggers() {
  const state = {
    events: new Map<string, EventInfo>(),
    preps: new Map<string, { status: string; topics: number }>(),
    reminders: new Map<string, ReminderInfo>(),
    insights: new Map<string, InsightInfo>(),
    approvals: new Map<string, ApprovalInfo>(),
    briefings: new Map<string, BriefingInfo>(),
    subscription: null as SubscriptionInfo | null,
    reminderStatus: new Map<string, string>(),
    delivered: [] as string[],
  };
  const repo: TriggerRepo = {
    event: (_u, id) => Promise.resolve(state.events.get(id) ?? null),
    meetingPrep: (_u, id) => Promise.resolve(state.preps.get(id) ?? null),
    reminder: (_u, id) => Promise.resolve(state.reminders.get(id) ?? null),
    setReminderStatus: (_u, id, status) =>
      Promise.resolve(void state.reminderStatus.set(id, status)),
    insight: (_u, id) => Promise.resolve(state.insights.get(id) ?? null),
    approval: (_u, id) => Promise.resolve(state.approvals.get(id) ?? null),
    briefing: (_u, id) => Promise.resolve(state.briefings.get(id) ?? null),
    markBriefingDelivered: (_u, id) => Promise.resolve(void state.delivered.push(id)),
    subscription: () => Promise.resolve(state.subscription),
  };
  return { repo, state };
}

type ExpoHandler = (call: RecordedCall, messages: ExpoMessage[]) => Response | Promise<Response>;

function setup(at: Date, handler?: ExpoHandler) {
  let now = at;
  const clock = () => now;
  const queue = memoryQueue(clock);
  const n = memoryNotifications(clock);
  const t = memoryTriggers();
  let counter = 0;
  const sent: ExpoMessage[][] = [];
  const stub = stubFetch(async (call) => {
    const body = await bodyOf(call);
    if (call.url.endsWith('/push/send')) {
      const messages = body as ExpoMessage[];
      sent.push(messages);
      if (handler !== undefined) return await handler(call, messages);
      return jsonResponse({ data: messages.map(() => ({ status: 'ok', id: `tk-${++counter}` })) });
    }
    if (handler !== undefined) return await handler(call, []);
    return jsonResponse({ data: {} });
  });
  const expo = createExpoPushClient({ accessToken: TOKEN, fetch: stub.fetch });
  const deps = { repo: n.repo, triggers: t.repo, expo };
  const jobIds = new Map<string, string>();
  const run = (
    payload: Record<string, unknown>,
    key = `test:${crypto.randomUUID()}`,
    attempts = 1,
  ) =>
    processNotification(
      deps,
      jobContext({
        type: 'notification',
        key,
        payload: NotificationJobPayload.parse({ user_id: USER_A, ...payload }),
        queue,
        now: clock,
        attempts,
        userId: USER_A,
        jobId: jobIds.get(key) ?? jobIds.set(key, crypto.randomUUID()).get(key),
      }),
    );
  return {
    queue,
    n,
    t,
    stub,
    sent,
    expo,
    deps,
    run,
    setNow(d: Date) {
      now = d;
    },
  };
}

function criticalBuild(over: Record<string, unknown> = {}) {
  return {
    category: 'critical_email',
    dedupe_key: `critical:${THREAD}`,
    entity: { type: 'email_thread', id: THREAD },
    deeplink: toDeepLink(routes.mailDetail(THREAD)),
    template_key: 'critical_email.reply_needed',
    params_sensitive: {
      sender: 'Ahmet Yılmaz',
      subject: 'Revize teklif',
      expectedAction: "Bugün 17:00'ye kadar yanıt bekliyor.",
    },
    urgency: 'urgent',
    ...over,
  };
}

Deno.test(
  'IT-NTF-05 / UT-NTF-11 send: title_only by default, data exactly {type, entity_id, deeplink}, channel and bearer token',
  async () => {
    const s = setup(DAY);
    s.n.addTarget(USER_A, { platform: 'android' });
    const out = await s.run({ build: criticalBuild() });
    assertEquals(out?.decision, 'sent');
    assertEquals(s.stub.calls.length, 1);
    const call = s.stub.calls[0];
    assertExists(call);
    assertEquals(call.url, 'https://exp.host/--/api/v2/push/send');
    assertEquals(call.headers.get('Authorization'), `Bearer ${TOKEN}`);
    const message = s.sent[0]?.[0];
    assertExists(message);
    assertEquals(message.title, 'Önemli e-posta');
    assertEquals(message.body, 'Bugün cevaplaman gereken önemli bir mail var.');
    assertEquals(Object.keys(message.data).sort(), ['deeplink', 'entity_id', 'type']);
    assertEquals(message.data.entity_id, THREAD);
    assertEquals(message.channelId, 'critical_email');
    assert(new TextEncoder().encode(JSON.stringify(message.data)).length < 1024);
    assert(!JSON.stringify(message).includes('Ahmet'));

    const row = [...s.n.rows.values()][0];
    assertEquals(row?.decision, 'sent');
    assertEquals(row?.detail_mode, 'title_only');
    assertEquals(row?.title_rendered, 'Önemli e-posta');
    assertEquals(s.n.tickets.length, 1);
    assertEquals(s.n.tickets[0]?.status, 'pending_receipt');
    const receipts = receiptsJobKey(new Date(DAY.getTime() + 15 * 60_000));
    assertEquals(s.queue.jobs.get(receipts)?.runAfter, '2026-09-23T09:15:00.000Z');
  },
);

Deno.test(
  'UT-NTF-10 / UT-NTF-12 render: full on Android (iOS capped while lock_screen_private), generic',
  async () => {
    const s = setup(DAY);
    s.n.states.set(USER_A, { prefs: { detail_level: 'full' } });
    s.n.addTarget(USER_A, { platform: 'android' });
    s.n.addTarget(USER_A, { platform: 'ios' });
    await s.run({ build: criticalBuild() });
    const [android, ios] = s.sent[0] ?? [];
    assertEquals(android?.title, 'Ahmet Yılmaz · Revize teklif');
    assertEquals(android?.body, "Bugün 17:00'ye kadar yanıt bekliyor.");
    assertEquals(ios?.title, 'Önemli e-posta');
    assertEquals([...s.n.rows.values()][0]?.detail_mode, 'title_only');

    const g = setup(DAY);
    g.n.states.set(USER_A, { prefs: { detail_level: 'generic' } });
    g.n.addTarget(USER_A, { platform: 'android' });
    await g.run({ build: criticalBuild() });
    assertEquals(g.sent[0]?.[0]?.title, 'Dijital Asistan');
    assertEquals(g.sent[0]?.[0]?.body, 'Yeni bir güncellemen var.');
  },
);

Deno.test(
  'UT-NTF-02 quiet hours: a non-VIP critical email at 23:10 is scheduled for 07:30 local and re-enqueued',
  async () => {
    const s = setup(QUIET);
    s.n.addTarget(USER_A);
    const out = await s.run({ build: criticalBuild() });
    assertEquals(out?.decision, 'scheduled');
    assertEquals(out?.deferred_until, QUIET_END);
    assertEquals(s.stub.calls.length, 0);
    const row = [...s.n.rows.values()][0];
    assertExists(row);
    assertEquals(row.decision, 'scheduled');
    assertEquals(row.scheduled_for, QUIET_END);
    const deferral = [...s.queue.jobs.values()].find((j) => j.key.startsWith(`notif:${row.id}:`));
    assertExists(deferral);
    assertEquals(deferral.runAfter, QUIET_END);
    assertEquals((deferral.payload as Record<string, unknown>).notification_id, row.id);

    // At 07:30 the deferred job sends the same row.
    s.setNow(new Date(QUIET_END));
    const later = await s.run(deferral.payload as Record<string, unknown>, deferral.key);
    assertEquals(later?.decision, 'sent');
    assertEquals(s.n.rows.size, 1);
    assertEquals([...s.n.rows.values()][0]?.decision, 'sent');
  },
);

Deno.test(
  'UT-NTF-09 / IT-NTF-07 VIP: a Pro VIP critical email bypasses quiet hours up to 3 per window',
  async () => {
    const s = setup(QUIET);
    s.n.states.set(USER_A, { isPro: true });
    s.n.addTarget(USER_A);
    const first = await s.run({
      build: criticalBuild({ vip: true, template_key: 'critical_email.vip' }),
    });
    assertEquals(first?.decision, 'sent');
    assertEquals(first?.bypassed_quiet_hours, true);
    for (const minute of [1, 2]) {
      s.n.addSent(USER_A, 'critical_email', new Date(QUIET.getTime() + minute * 60_000));
    }
    s.setNow(new Date(QUIET.getTime() + 5 * 60_000));
    const fourth = await s.run({
      build: criticalBuild({ vip: true, dedupe_key: 'critical:vip-4' }),
    });
    assertEquals(fourth?.decision, 'scheduled');
    assertEquals(fourth?.deferred_until, QUIET_END);

    const free = setup(QUIET);
    free.n.addTarget(USER_A);
    const notPro = await free.run({ build: criticalBuild({ vip: true }) });
    assertEquals(notPro?.decision, 'scheduled');
  },
);

Deno.test(
  'UT-NTF-04 dedupe: the same dedupe_key again is a deduplicated ledger row and no send',
  async () => {
    const s = setup(DAY);
    s.n.addTarget(USER_A);
    await s.run({ build: criticalBuild() });
    const again = await s.run({ build: criticalBuild() });
    assertEquals(again?.decision, 'deduplicated');
    assertEquals(s.sent.length, 1);
    const dup = [...s.n.rows.values()].find((r) => r.decision === 'deduplicated');
    assertExists(dup);
    assertEquals(dup.suppression_reason, 'deduplicated');
    assert(dup.dedupe_key.startsWith(`critical:${THREAD}#dup:`));
  },
);

Deno.test(
  'UT-NTF-05 daily cap: the 6th non-critical push in 24 h is suppressed frequency_cap (R-14)',
  async () => {
    const s = setup(DAY);
    s.n.addTarget(USER_A);
    for (let i = 1; i <= 5; i++)
      s.n.addSent(USER_A, 'approval', new Date(DAY.getTime() - i * 3_600_000));
    const out = await s.run({
      build: {
        category: 'approval',
        dedupe_key: 'approval_pending:x',
        entity: null,
        deeplink: toDeepLink(routes.approvals()),
        template_key: 'approval.pending',
        params_public: { count: 1 },
        urgency: 'today',
      },
    });
    assertEquals(out?.decision, 'suppressed');
    assertEquals(out?.reason, 'frequency_cap');
    assertEquals(s.sent.length, 0);
    const critical = await s.run({ build: criticalBuild() });
    assertEquals(critical?.decision, 'sent');
  },
);

Deno.test(
  'UT-NTF-16 a user reminder at 23:15 inside quiet hours is delivered on the reminders channel',
  async () => {
    const at = new Date('2026-09-23T20:15:00.000Z');
    const s = setup(at);
    s.n.addTarget(USER_A, { platform: 'android' });
    const id = crypto.randomUUID();
    s.t.state.reminders.set(id, {
      id,
      title: 'İlacını al',
      remind_at: at.toISOString(),
      channel: 'push',
      status: 'scheduled',
      notification_category: 'deadline',
    });
    const out = await s.run({ trigger: 'reminder', reminder_id: id }, `reminder:${id}`);
    assertEquals(out?.decision, 'sent');
    assertEquals(s.sent[0]?.[0]?.channelId, 'reminders');
    assertEquals(s.sent[0]?.[0]?.data.type, 'reminder');
    assertEquals(s.t.state.reminderStatus.get(id), 'delivered');
  },
);

Deno.test(
  'UT-NTF-17 admin test push at 23:00 local is scheduled for 07:30 and rendered generic',
  async () => {
    const s = setup(new Date('2026-09-23T20:00:00.000Z'));
    s.n.states.set(USER_A, { prefs: { detail_level: 'full', lock_screen_private: false } });
    s.n.addTarget(USER_A, { platform: 'android' });
    const payload = {
      kind: 'test',
      category: 'account',
      detail_mode: 'generic',
      installation_id: null,
      bypass_caps: true,
      bypass_quiet_hours: false,
      admin_id: crypto.randomUUID(),
    };
    const out = await s.run(payload);
    assertEquals(out?.decision, 'scheduled');
    assertEquals(out?.deferred_until, QUIET_END);
    const row = [...s.n.rows.values()][0];
    assertEquals(row?.detail_mode, 'generic');
    assertEquals(row?.is_test, true);
    s.setNow(new Date(QUIET_END));
    const deferral = [...s.queue.jobs.values()].find((j) => j.key.startsWith('notif:'));
    assertExists(deferral);
    await s.run(deferral.payload as Record<string, unknown>, deferral.key);
    assertEquals(s.sent[0]?.[0]?.title, 'Dijital Asistan');
  },
);

Deno.test(
  'JOB-18 without EXPO_ACCESS_TOKEN the row fails EXTERNAL_CREDENTIAL_REQUIRED (no fake success)',
  async () => {
    const s = setup(DAY);
    s.n.addTarget(USER_A);
    const error = await assertRejects(
      () =>
        processNotification(
          { ...s.deps, expo: null },
          jobContext({
            type: 'notification',
            key: 'k',
            payload: NotificationJobPayload.parse({ user_id: USER_A, build: criticalBuild() }),
            queue: s.queue,
            now: () => DAY,
          }),
        ),
      JobError,
    );
    assertEquals(error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(error.retryable, false);
    const row = [...s.n.rows.values()][0];
    assertEquals(row?.decision, 'failed');
    assertEquals(row?.error_code, 'EXTERNAL_CREDENTIAL_REQUIRED');
  },
);

Deno.test(
  'IT-NTF-03 Expo 429/5xx: retryable, no ticket; the retry sends once; tickets block a resend',
  async () => {
    let fail = true;
    const s = setup(DAY, (_call, messages) =>
      fail
        ? new Response('busy', { status: 429, headers: { 'Retry-After': '7' } })
        : jsonResponse({ data: messages.map((_, i) => ({ status: 'ok', id: `tk-${i}` })) }),
    );
    s.n.addTarget(USER_A);
    const key = 'test:retry';
    const error = await assertRejects(() => s.run({ build: criticalBuild() }, key), JobError);
    assertEquals(error.retryable, true);
    assertEquals(error.retryAfterSeconds, 7);
    assertEquals(s.n.tickets.length, 0);
    assertEquals([...s.n.rows.values()][0]?.decision, 'scheduled');
    fail = false;
    const retry = await s.run({ build: criticalBuild() }, key, 2);
    assertEquals(retry?.decision, 'sent');
    assertEquals(s.n.tickets.length, 1);

    // A crash after the tickets were stored: the next attempt completes without sending again.
    const row = [...s.n.rows.values()][0];
    assertExists(row);
    s.n.rows.set(row.id, { ...row, decision: 'scheduled', sent_at: null });
    const calls = s.stub.calls.length;
    const resumed = await s.run({ build: criticalBuild(), notification_id: row.id }, key, 3);
    assertEquals(resumed?.resumed, true);
    assertEquals(s.stub.calls.length, calls);
  },
);

Deno.test('JOB-18 DeviceNotRegistered on the ticket disables the token at once', async () => {
  const s = setup(DAY, (_call, messages) =>
    jsonResponse({
      data: messages.map((_, i) =>
        i === 0
          ? {
              status: 'error',
              message: 'not registered',
              details: { error: 'DeviceNotRegistered' },
            }
          : { status: 'ok', id: 'tk-ok' },
      ),
    }),
  );
  const dead = s.n.addTarget(USER_A);
  s.n.addTarget(USER_A);
  const out = await s.run({ build: criticalBuild() });
  assertEquals(out?.decision, 'sent');
  assertEquals(out?.tokens_disabled, 1);
  assertEquals(s.n.targets.find((t) => t.tokenId === dead.tokenId)?.enabled, false);
  assertEquals(
    s.n.targets.find((t) => t.tokenId === dead.tokenId)?.disabledReason,
    'device_not_registered',
  );
  assertEquals(s.n.tickets.map((t) => t.status).sort(), ['error', 'pending_receipt']);
});

Deno.test('JOB-18 no active device: suppressed no_device, nothing sent', async () => {
  const s = setup(DAY);
  const out = await s.run({ build: criticalBuild() });
  assertEquals(out?.decision, 'suppressed');
  assertEquals(out?.reason, 'no_device');
  assertEquals(s.stub.calls.length, 0);
});

Deno.test(
  'IT-NTF-02 Expo batching: 250 messages → 100/100/50 requests, gzip above 1 KiB',
  async () => {
    const sizes: number[] = [];
    const stub = stubFetch(async (call) => {
      const messages = (await bodyOf(call)) as unknown[];
      sizes.push(messages.length);
      assertEquals(call.headers.get('Content-Encoding'), 'gzip');
      assertEquals(call.headers.get('Authorization'), `Bearer ${TOKEN}`);
      return jsonResponse({ data: messages.map((_, i) => ({ status: 'ok', id: `t${i}` })) });
    });
    const expo = createExpoPushClient({ accessToken: TOKEN, fetch: stub.fetch });
    const message: ExpoMessage = {
      to: 'ExponentPushToken[x]',
      title: 'Dijital Asistan',
      body: 'Yeni bir güncellemen var.',
      data: { type: 'account', entity_id: null, deeplink: 'dijitalasistan://today' },
      sound: 'default',
      channelId: 'account',
      categoryId: 'account',
      priority: 'normal',
      interruptionLevel: 'active',
      relevanceScore: 0.5,
      threadId: 'account',
      collapseId: 'c',
      ttl: 3600,
    };
    const tickets = await expo.send(Array.from({ length: 250 }, () => message));
    assertEquals(sizes, [100, 100, 50]);
    assertEquals(tickets.length, 250);
  },
);

Deno.test(
  'IT-NTF-04 receipts: batches ≤1000, DeviceNotRegistered disables, MessageRateExceeded backs off, credentials degrade health',
  async () => {
    const s = setup(DAY, (call) => {
      assert(call.url.endsWith('/--/api/v2/push/getReceipts'));
      return jsonResponse({
        data: {
          'tk-1': { status: 'ok' },
          'tk-2': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          'tk-3': { status: 'error', message: 'slow', details: { error: 'MessageRateExceeded' } },
          'tk-4': { status: 'error', message: 'creds', details: { error: 'InvalidCredentials' } },
        },
      });
    });
    const targets = [1, 2, 3, 4].map(() => s.n.addTarget(USER_A));
    const sentAt = new Date(DAY.getTime() - 20 * 60_000).toISOString();
    await s.n.repo.insertTickets(
      targets.map((t, i) => ({
        user_id: USER_A,
        notification_id: crypto.randomUUID(),
        push_token_id: t.tokenId,
        expo_ticket_id: `tk-${i + 1}`,
        status: 'pending_receipt',
        error_code: null,
        sent_at: sentAt,
      })),
    );
    await s.n.repo.insertTickets([
      {
        user_id: USER_A,
        notification_id: crypto.randomUUID(),
        push_token_id: targets[0]?.tokenId ?? '',
        expo_ticket_id: 'tk-fresh',
        status: 'pending_receipt',
        error_code: null,
        sent_at: new Date(DAY.getTime() - 5 * 60_000).toISOString(),
      },
    ]);
    const out = await processPushReceipts(
      { repo: s.n.repo, expo: s.expo },
      jobContext<PushReceiptsPayload>({
        type: 'push_receipts',
        key: 'push_receipts:x',
        payload: {},
        queue: s.queue,
        now: () => DAY,
      }),
    );
    assertEquals(out?.checked, 4);
    assertEquals(out?.ok, 1);
    assertEquals(out?.tokens_disabled, 1);
    const body = (await bodyOf(s.stub.calls[0] as RecordedCall)) as { ids: string[] };
    assertEquals(body.ids.sort(), ['tk-1', 'tk-2', 'tk-3', 'tk-4']);
    assertEquals(
      targets[1] && s.n.targets.find((t) => t.tokenId === targets[1]?.tokenId)?.enabled,
      false,
    );
    assert(s.n.backoffs.has(targets[2]?.tokenId ?? ''));
    assertEquals(s.n.health[0]?.status, 'degraded');
    assertEquals(
      s.n.tickets.find((t) => t.expo_ticket_id === 'tk-fresh')?.status,
      'pending_receipt',
    );
    // The backed-off token is skipped by the next send.
    const active = await s.n.repo.activeTargets(USER_A, null, DAY);
    assert(!active.some((t) => t.tokenId === targets[2]?.tokenId));
  },
);

Deno.test(
  'IT-NTF-06 meeting prep T-20 and post-meeting at end +1 min (Europe/Berlin user)',
  async () => {
    const start = new Date('2026-09-23T12:00:00.000Z'); // 14:00 Berlin
    const s = setup(new Date(start.getTime() - 20 * 60_000));
    s.n.states.set(USER_A, {
      isPro: true,
      timeZone: 'Europe/Berlin',
      prefs: { detail_level: 'full' },
    });
    s.n.addTarget(USER_A, { platform: 'android' });
    const id = crypto.randomUUID();
    s.t.state.events.set(id, {
      id,
      title: 'Bütçe görüşmesi',
      start_at: start.toISOString(),
      end_at: '2026-09-23T13:00:00.000Z',
      status: 'confirmed',
      all_day: false,
      attendee_count: 3,
      provider_deleted_at: null,
    });
    s.t.state.preps.set(id, { status: 'ready', topics: 2 });
    const prep = await s.run({ trigger: 'meeting_prep', category: 'meeting', event_id: id });
    assertEquals(prep?.decision, 'sent');
    const message = s.sent[0]?.[0];
    assertEquals(message?.title, '14:00 · Bütçe görüşmesi');
    assertEquals(message?.body, 'Toplantına 20 dakika kaldı. 2 hazırlık notun var.');
    assertEquals(message?.interruptionLevel, 'active');
    const key = `meeting_prep:${id}:${Math.floor(start.getTime() / 1000)}`;
    assert([...s.n.rows.values()].some((r) => r.dedupe_key === key));

    // Post-meeting: before end + 1 min it is deferred to that time; then sent passively.
    s.setNow(new Date('2026-09-23T13:00:00.000Z'));
    const early = await s.run({ trigger: 'post_meeting', category: 'meeting', event_id: id });
    assertEquals(early?.deferred_until, '2026-09-23T13:01:00.000Z');
    s.setNow(new Date('2026-09-23T13:01:00.000Z'));
    const deferral = [...s.queue.jobs.values()].find((j) => j.key.startsWith('notif:'));
    assertExists(deferral);
    const post = await s.run(deferral.payload as Record<string, unknown>, deferral.key);
    assertEquals(post?.decision, 'sent');
    assertEquals(s.sent[1]?.[0]?.title, 'Bütçe görüşmesi bitti');
    assertEquals(s.sent[1]?.[0]?.interruptionLevel, 'passive');

    // Free users: meeting prep is Pro (not_entitled).
    const free = setup(new Date(start.getTime() - 20 * 60_000));
    free.n.addTarget(USER_A);
    free.t.state.events.set(id, s.t.state.events.get(id) as EventInfo);
    const denied = await free.run({ trigger: 'meeting_prep', category: 'meeting', event_id: id });
    assertEquals(denied?.reason, 'not_entitled');
  },
);

Deno.test(
  'T-6.08 deadline nudge uses the local day key and Turkish inflected time; a cancelled event skips',
  async () => {
    const s = setup(DAY);
    s.n.states.set(USER_A, { prefs: { detail_level: 'full' } });
    s.n.addTarget(USER_A, { platform: 'android' });
    const insight = crypto.randomUUID();
    s.t.state.insights.set(insight, {
      id: insight,
      kind: 'deadline',
      status: 'open',
      title: 'Vergi beyannamesi',
      urgency: 'today',
      entity_type: 'task',
      entity_id: crypto.randomUUID(),
      due_at: '2026-09-23T14:00:00.000Z',
      event_at: null,
      created_at: '2026-09-22T09:00:00.000Z',
      person: null,
    });
    const out = await s.run({ trigger: 'nudge', category: 'deadline', insight_id: insight });
    assertEquals(out?.decision, 'sent');
    assertEquals(s.sent[0]?.[0]?.title, 'Son tarih: Vergi beyannamesi');
    assertEquals(s.sent[0]?.[0]?.body, "Bugün 17:00'de kapanıyor.");
    assert([...s.n.rows.values()].some((r) => r.dedupe_key === `nudge:${insight}:2026-09-23`));

    const gone = crypto.randomUUID();
    s.t.state.events.set(gone, {
      id: gone,
      title: null,
      start_at: '2026-09-23T10:00:00.000Z',
      end_at: '2026-09-23T11:00:00.000Z',
      status: 'cancelled',
      all_day: false,
      attendee_count: 2,
      provider_deleted_at: null,
    });
    const skipped = await s.run({ trigger: 'meeting_prep', category: 'meeting', event_id: gone });
    assertEquals(skipped?.skipped, 'event_gone');
  },
);

Deno.test(
  'T-6.08 approval expiry push only while pending; trial ending and briefing delivered',
  async () => {
    const s = setup(DAY);
    s.n.states.set(USER_A, { isPro: true });
    s.n.addTarget(USER_A, { platform: 'android' });
    const approval = crypto.randomUUID();
    s.t.state.approvals.set(approval, {
      id: approval,
      status: 'pending',
      what: 'Toplantı oluştur',
      action_type: 'calendar_create',
      approval_expires_at: new Date(DAY.getTime() + 90 * 60_000).toISOString(),
      attempt_count: 0,
      payload_version: 1,
    });
    const expiring = await s.run({ trigger: 'approval_expiring', approval_id: approval });
    assertEquals(expiring?.decision, 'sent', JSON.stringify(expiring));
    assertEquals(s.sent[0]?.[0]?.interruptionLevel, 'time-sensitive');
    s.t.state.approvals.set(approval, {
      ...(s.t.state.approvals.get(approval) as ApprovalInfo),
      status: 'approved',
    });
    const skipped = await s.run(
      { trigger: 'approval_expiring', approval_id: approval },
      'other-key',
    );
    assertEquals(skipped?.skipped, 'not_pending');

    s.t.state.subscription = {
      status: 'active',
      period_type: 'trial',
      expires_at: new Date(DAY.getTime() + 20 * 3_600_000).toISOString(),
      will_renew: true,
      product_id: 'pro_monthly',
    };
    const trial = await s.run({ trigger: 'trial_ending' });
    assertEquals(trial?.decision, 'sent');

    const briefing = crypto.randomUUID();
    s.t.state.briefings.set(briefing, {
      id: briefing,
      kind: 'morning',
      status: 'ready',
      scheduled_for: DAY.toISOString(),
      headline: 'Üç önemli konu',
      counts: { headline: 3 },
      weekly_stats: null,
    });
    const morning = await s.run({ trigger: 'briefing', briefing_id: briefing });
    assertEquals(morning?.decision, 'sent');
    assertEquals(s.t.state.delivered, [briefing]);
    const midday = crypto.randomUUID();
    s.t.state.briefings.set(midday, {
      id: midday,
      kind: 'midday',
      status: 'ready',
      scheduled_for: DAY.toISOString(),
      headline: null,
      counts: { headline: 0 },
      weekly_stats: null,
    });
    const quiet = await s.run({ trigger: 'briefing', briefing_id: midday });
    assertEquals(quiet?.skipped, 'no_meaningful_delta');
  },
);

Deno.test(
  'T-6.08 late delivery: a push more than 90 min past its time is suppressed late_delivery',
  async () => {
    const s = setup(DAY);
    s.n.addTarget(USER_A);
    const out = await s.run({
      build: criticalBuild({
        scheduled_for: new Date(DAY.getTime() - 2 * 3_600_000).toISOString(),
      }),
    });
    assertEquals(out?.decision, 'suppressed');
    assertEquals(out?.reason, 'late_delivery');
  },
);

Deno.test('NotificationJobPayload: exactly one form; unknown templates are poison', () => {
  assert(!NotificationJobPayload.safeParse({ user_id: USER_A }).success);
  assert(
    !NotificationJobPayload.safeParse({
      user_id: USER_A,
      trigger: 'reminder',
      build: criticalBuild(),
    }).success,
  );
  assert(
    !NotificationJobPayload.safeParse({
      user_id: USER_A,
      build: criticalBuild({ template_key: 'critical_email.nope' }),
    }).success,
  );
  assert(NotificationJobPayload.safeParse({ user_id: USER_A, build: criticalBuild() }).success);
});
