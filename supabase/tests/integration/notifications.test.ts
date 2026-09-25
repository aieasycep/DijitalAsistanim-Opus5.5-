/**
 * IT-NTF-* (TEST_PLAN §6.7; API_CONTRACTS JOB-18 `notification`, JOB-19 `push_receipts`; ADR-10,
 * R-12, R-13): decision rows, Expo batching with the enhanced-security bearer, retries, receipts,
 * payload shape, meeting timing and quiet hours, all through the worker against the Expo mock.
 */
import { assert, assertEquals } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  env,
  it,
  makePro,
  mock,
  one,
  q,
  releaseJobs,
  type TestUser,
} from './_harness/mod.ts';
import { sha256Hex } from './_harness/flows.ts';

/** `n` signed-in iOS installations with active Expo tokens. */
async function devices(user: TestUser, n = 1, platform = 'ios'): Promise<string[]> {
  const rows = await q<{ token: string }>(
    `with inst as (
       insert into public.app_installations (user_id, installation_id, platform, app_version, build_number, push_enabled,
         platform_capabilities, device_hash, last_seen_at, created_at, updated_at)
       select $1, gen_random_uuid(), $3::public.platform, '1.4.0', '812', true, '{}'::jsonb,
              sha256(convert_to(gen_random_uuid()::text, 'UTF8')), now(), now(), now()
       from generate_series(1, $2::int)
       returning id)
     insert into public.push_tokens (user_id, installation_id, expo_push_token, status, last_registered_at, created_at, updated_at)
     select $1, inst.id, 'ExponentPushToken[' || substr(md5(inst.id::text), 1, 22) || ']', 'active', now(), now(), now() from inst
     returning expo_push_token as token`,
    [user.id, n, platform],
  );
  await q(
    `update public.notification_preferences set os_permission = 'granted' where user_id = $1`,
    [user.id],
  );
  return rows.map((r) => r.token);
}

interface BuildOptions {
  category?: string;
  template?: string;
  dedupe?: string;
  urgency?: string;
  vip?: boolean;
  key?: string;
  params?: Record<string, string>;
}

/** Enqueues a documented `build` notification job (what the insight / briefing pipelines enqueue). */
async function notify(user: TestUser, o: BuildOptions = {}): Promise<string> {
  const dedupe = o.dedupe ?? `critical_email:email_thread:${crypto.randomUUID()}:2026-09-25`;
  const payload = {
    user_id: user.id,
    build: {
      category: o.category ?? 'critical_email',
      dedupe_key: dedupe,
      entity: { type: 'email_thread', id: crypto.randomUUID() },
      deeplink: 'dijitalasistan://mail/threads',
      template_key: o.template ?? 'critical_email.reply_needed',
      params_public: {},
      params_sensitive: o.params ?? {
        sender: 'Ahmet Yılmaz',
        subject: 'Re: Eylül teklifi – revize',
        expectedAction: 'Bugün 17:00’ye kadar yanıt bekliyor.',
      },
      urgency: o.urgency ?? 'urgent',
      vip: o.vip ?? false,
    },
  };
  const row = await one<{ id: string }>(
    `select private.enqueue_job('notification', $1, $2::text::jsonb, $3::uuid, null, now(), 50, 5, null) as id`,
    [
      o.key ?? `notif:${user.id}:${dedupe}:${crypto.randomUUID()}`,
      JSON.stringify(payload),
      user.id,
    ],
  );
  return row.id;
}

async function sendRequests() {
  return (await mock.requests('/expo/--/api/v2/push/send')).filter((r) => r.method === 'POST');
}

function messagesOf(body: string): Record<string, unknown>[] {
  const parsed = JSON.parse(body) as unknown;
  return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
}

async function run(types = ['notification']): Promise<void> {
  await releaseJobs();
  await drain({ types });
}

it(
  'IT-NTF-01',
  'a notifications row per decision incl. suppressed / deduplicated; (user_id, dedupe_key) unique under concurrency',
  async () => {
    const silent = await createUser();
    await notify(silent);
    await run();
    const suppressed = await one<{ decision: string; suppression_reason: string }>(
      `select decision, suppression_reason from public.notifications where user_id = $1`,
      [silent.id],
    );
    assertEquals(suppressed.decision, 'suppressed');
    assertEquals(suppressed.suppression_reason, 'no_device');

    const user = await createUser();
    await devices(user);
    const dedupe = `critical_email:email_thread:${crypto.randomUUID()}:2026-09-25`;
    // Two jobs for the same dedupe key, claimed by two concurrent worker invocations.
    await notify(user, { dedupe, key: `a:${dedupe}` });
    await notify(user, { dedupe, key: `b:${dedupe}` });
    await releaseJobs();
    await Promise.all([
      drain({ types: ['notification'], rounds: 1 }),
      drain({ types: ['notification'], rounds: 1 }),
    ]);
    await run();
    const rows = await q<{ decision: string; suppression_reason: string | null }>(
      `select decision, suppression_reason from public.notifications where user_id = $1 and dedupe_key = $2`,
      [user.id, dedupe],
    );
    assertEquals(rows.length, 1, JSON.stringify(rows));
    assertEquals((await sendRequests()).length, 1);
    const jobs = await q<{ status: string; result: Record<string, unknown> | null }>(
      `select status, result from public.jobs where type = 'notification' and user_id = $1`,
      [user.id],
    );
    assertEquals(jobs.filter((j) => j.status === 'completed').length, 2, JSON.stringify(jobs));
    assert(
      jobs.some((j) => JSON.stringify(j.result).includes('dedup')),
      JSON.stringify(jobs),
    );
    for (const r of await q<{ decision: string; suppression_reason: string | null }>(
      `select decision, suppression_reason from public.notifications where user_id = $1`,
      [user.id],
    )) {
      if (r.decision === 'suppressed' || r.decision === 'deduplicated')
        assert(r.suppression_reason !== null);
    }
  },
);

it(
  'IT-NTF-02',
  '250 devices → 3 Expo requests (100/100/50) with the access token; tickets stored',
  async () => {
    const user = await createUser();
    await devices(user, 250);
    await notify(user);
    await run();
    const sends = await sendRequests();
    assertEquals(
      sends.map((r) => messagesOf(r.body).length),
      [100, 100, 50],
    );
    for (const r of sends)
      assertEquals(r.headers.authorization, `Bearer ${env('EXPO_ACCESS_TOKEN')}`);
    assertEquals(
      await count(
        `select 1 from public.push_tickets where user_id = $1 and status in ('ok','pending_receipt')`,
        [user.id],
      ),
      250,
    );
  },
);

it('IT-NTF-03', 'Expo 429 / 5xx → retry with backoff and no duplicate ticket', async () => {
  const user = await createUser();
  await devices(user, 2);
  await mock.script('POST /expo/--/api/v2/push/send', [
    { status: 429, headers: { 'Retry-After': '3' }, fixture: 'expo/send_429.json' },
    { status: 503, body: { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'unavailable' }] } },
  ]);
  const jobId = await notify(user);
  await releaseJobs();
  const started = Date.now();
  await drain({ types: ['notification'], rounds: 1 });
  const first = await one<{ status: string; run_after: Date }>(
    `select status, run_after from public.jobs where id = $1`,
    [jobId],
  );
  assertEquals(first.status, 'retrying');
  assert(new Date(first.run_after).getTime() - started >= 2500, 'Retry-After honoured');
  for (let i = 0; i < 3; i++) await run();
  assertEquals(
    (await one<{ status: string }>(`select status from public.jobs where id = $1`, [jobId])).status,
    'completed',
  );
  assertEquals(await count(`select 1 from public.push_tickets where user_id = $1`, [user.id]), 2);
  assertEquals((await sendRequests()).filter((r) => r.status === 200).length, 1);
});

it(
  'IT-NTF-04',
  'push_receipts: batches ≤ 1000; DeviceNotRegistered disables the token; MessageRateExceeded backs off',
  async () => {
    const user = await createUser();
    const tokens = await devices(user, 3);
    await mock.expo({
      op: 'receipt_for_token',
      token: tokens[0],
      receipt: JSON.parse(
        Deno.readTextFileSync(
          new URL(
            '../../functions/_shared/testing/fixtures/expo/receipt_device_not_registered.json',
            import.meta.url,
          ),
        ),
      ),
    });
    await mock.expo({
      op: 'receipt_for_token',
      token: tokens[1],
      receipt: JSON.parse(
        Deno.readTextFileSync(
          new URL(
            '../../functions/_shared/testing/fixtures/expo/receipt_message_rate_exceeded.json',
            import.meta.url,
          ),
        ),
      ),
    });
    await notify(user);
    await run();
    const receiptsJob = await one<{ run_after: Date }>(
      `select run_after from public.jobs where type = 'push_receipts' order by created_at desc limit 1`,
    );
    const wait = new Date(receiptsJob.run_after).getTime() - Date.now();
    assert(wait > 10 * 60_000 && wait <= 20 * 60_000, `receipts after ${wait} ms`);
    // Receipts are read 15 minutes after the send: the tickets age, the job runs.
    await q(
      `update public.push_tickets set sent_at = sent_at - interval '16 minutes', created_at = created_at - interval '16 minutes' where user_id = $1`,
      [user.id],
    );
    await run(['push_receipts']);
    const calls = (await mock.requests('/expo/--/api/v2/push/getReceipts')).filter(
      (r) => r.method === 'POST',
    );
    assert(
      calls.length >= 1,
      JSON.stringify(
        await q(`select type, status, result from public.jobs where type = 'push_receipts'`),
      ),
    );
    for (const c of calls) assert((JSON.parse(c.body) as { ids: string[] }).ids.length <= 1000);
    const statuses = await q<{
      expo_push_token: string;
      status: string;
      disabled_reason: string | null;
    }>(
      `select expo_push_token, status, disabled_reason from public.push_tokens where user_id = $1`,
      [user.id],
    );
    const byToken = new Map(statuses.map((s) => [s.expo_push_token, s]));
    assertEquals(byToken.get(tokens[0] ?? '')?.status, 'disabled');
    assertEquals(byToken.get(tokens[1] ?? '')?.status, 'active');
    assertEquals(byToken.get(tokens[2] ?? '')?.status, 'active');
    assert(
      (await count(`select 1 from public.rate_limits where key like 'push_backoff:%'`)) >= 1,
      'per-device backoff',
    );
    assertEquals(
      await count(
        `select 1 from public.push_tickets where user_id = $1 and error_code = 'DeviceNotRegistered'`,
        [user.id],
      ),
      1,
    );
  },
);

it(
  'IT-NTF-05',
  'payload: channelId per category, interruptionLevel, data keys exactly {type, entity_id, deeplink}',
  async () => {
    const user = await createUser();
    await devices(user, 1);
    await devices(user, 1, 'android');
    await notify(user, { category: 'critical_email', template: 'critical_email.reply_needed' });
    await notify(user, {
      category: 'approval',
      template: 'approval.pending',
      urgency: 'today',
      params: {},
    });
    await run();
    const messages = (await sendRequests()).flatMap((r) => messagesOf(r.body));
    assert(messages.length >= 4, JSON.stringify(messages));
    for (const m of messages) {
      assertEquals(Object.keys(m.data as object).sort(), ['deeplink', 'entity_id', 'type']);
      assert(
        typeof m.channelId === 'string' || typeof m.interruptionLevel === 'string',
        JSON.stringify(m),
      );
    }
    const channels = new Set(messages.map((m) => m.channelId).filter((c) => c !== undefined));
    assert(channels.has('critical_email') && channels.has('approvals'), [...channels].join(','));
    const ios = messages.filter((m) => m.interruptionLevel !== undefined);
    assert(
      ios.some((m) => m.interruptionLevel === 'time-sensitive' || m.interruptionLevel === 'active'),
    );
    // Default detail level renders the notification per `notification_detail`.
    const row = await one<{ detail_mode: string; title_rendered: string | null }>(
      `select detail_mode, title_rendered from public.notifications where user_id = $1 and category = 'critical_email'`,
      [user.id],
    );
    assert(['full', 'title_only', 'generic'].includes(row.detail_mode));
    assert(row.title_rendered !== null && row.title_rendered.length > 0);
  },
);

it(
  'IT-NTF-06',
  'meeting prep T-30…T-15 and post-meeting at end + 1 min; a moved event reschedules once',
  async () => {
    const user = await createUser();
    await makePro(user.id);
    await devices(user);
    const { meeting_prep_lead_min: lead } = await one<{ meeting_prep_lead_min: number }>(
      `select meeting_prep_lead_min from public.notification_preferences where user_id = $1`,
      [user.id],
    );
    assert(lead >= 15 && lead <= 30, `lead ${lead}`);
    // The tick picks events that start in [now + lead, now + lead + 1 min).
    const start = new Date(Date.now() + (lead + 0.5) * 60_000);
    start.setUTCMilliseconds(0);
    const end = new Date(start.getTime() + 60 * 60_000);
    const installation = crypto.randomUUID();
    const snapshot = async (startAt: Date) => {
      const calendarHash = await sha256Hex('ios-work');
      const res = await call('api', 'POST', '/integrations/device-calendar/snapshot', {
        jwt: user.jwt,
        key: crypto.randomUUID(),
        body: {
          snapshot_id: crypto.randomUUID(),
          provider: 'apple_device',
          installation_id: installation,
          window: {
            start: new Date(Date.now() - 86_400_000).toISOString(),
            end: new Date(Date.now() + 10 * 86_400_000).toISOString(),
          },
          snapshot_at: new Date().toISOString(),
          content_hash: await sha256Hex(startAt.toISOString()),
          calendars: [
            {
              device_calendar_hash: calendarHash,
              title: 'İş',
              source_title: 'iCloud',
              color: null,
              allows_modifications: true,
              selected: true,
            },
          ],
          events: [
            {
              event_key_hash: await sha256Hex('mehmet-musteri'),
              device_calendar_hash: calendarHash,
              title: 'Mehmet müşteri toplantısı',
              start_at: startAt.toISOString(),
              end_at: new Date(startAt.getTime() + 3_600_000).toISOString(),
              all_day: false,
              location: null,
              attendee_count: 2,
              organizer_is_self: true,
              meeting_url: null,
              status: 'confirmed',
              last_modified_at: null,
            },
          ],
        },
      });
      assertEquals(res.status, 202, await res.text());
      await releaseJobs();
      await drain({ types: ['device_calendar_ingest'] });
    };
    await snapshot(start);
    const event = await one<{ id: string }>(
      `select id from public.calendar_events where user_id = $1`,
      [user.id],
    );
    await q(`select private.scheduler_tick(now())`);
    const prep = await q<{ idempotency_key: string; run_after: Date }>(
      `select idempotency_key, run_after from public.jobs where type = 'notification' and user_id = $1 and idempotency_key like 'meeting_prep_notify:%'`,
      [user.id],
    );
    assertEquals(prep.length, 1, JSON.stringify(prep));
    assertEquals(
      prep[0]?.idempotency_key,
      `meeting_prep_notify:${event.id}:${Math.floor(start.getTime() / 1000)}`,
    );
    const before = (start.getTime() - new Date(prep[0]?.run_after as Date).getTime()) / 60_000;
    assert(before >= 15 && before <= 31, `prep sent ${before} min before the start`);
    // Post-meeting: a tick at end + 1 min enqueues post_meeting:{event_id}.
    await q(`select private.scheduler_tick($1::timestamptz)`, [
      new Date(end.getTime() + 60_000).toISOString(),
    ]);
    const post = await q<{ idempotency_key: string; run_after: Date }>(
      `select idempotency_key, run_after from public.jobs where type = 'notification' and user_id = $1 and idempotency_key like '%post_meeting:%'`,
      [user.id],
    );
    assertEquals(
      post.map((p) => p.idempotency_key),
      [`post_meeting:${event.id}`],
    );
    assertEquals(new Date(post[0]?.run_after as Date).getTime(), end.getTime() + 60_000);
    // The event moves 2 h later: two ticks in the new window enqueue exactly one new prep job.
    const moved = new Date(start.getTime() + 2 * 3_600_000);
    await snapshot(moved);
    const tickAt = new Date(moved.getTime() - (lead + 0.5) * 60_000).toISOString();
    await q(`select private.scheduler_tick($1::timestamptz)`, [tickAt]);
    await q(`select private.scheduler_tick($1::timestamptz)`, [tickAt]);
    const again = await q<{ idempotency_key: string }>(
      `select idempotency_key from public.jobs where type = 'notification' and user_id = $1 and idempotency_key = $2`,
      [user.id, `meeting_prep_notify:${event.id}:${Math.floor(moved.getTime() / 1000)}`],
    );
    assertEquals(again.length, 1);
  },
);

/** Quiet hours around the current local time (Istanbul): [now − 1 h, now + 2 h). */
async function quietNow(user: TestUser): Promise<Date> {
  const local = new Date(Date.now() + 3 * 3_600_000); // Europe/Istanbul is UTC+3 all year.
  const hhmm = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const startLocal = new Date(local.getTime() - 3_600_000);
  const endLocal = new Date(local.getTime() + 2 * 3_600_000);
  endLocal.setUTCSeconds(0, 0);
  await q(
    `update public.notification_preferences set quiet_hours_enabled = true, quiet_start = $2::time, quiet_end = $3::time,
       quiet_days = '{1,2,3,4,5,6,7}', vip_bypass_quiet = true where user_id = $1`,
    [user.id, hhmm(startLocal), hhmm(endLocal)],
  );
  return new Date(endLocal.getTime() - 3 * 3_600_000);
}

it(
  'IT-NTF-07',
  'quiet hours: VIP critical_email sent (3 in the window), the 4th and non-VIP scheduled, admin test push scheduled generic',
  async () => {
    const user = await createUser({ pro: true });
    await devices(user);
    const quietEnd = await quietNow(user);
    for (let i = 0; i < 4; i++) await notify(user, { vip: true });
    await notify(user, { vip: false });
    // The admin test push job (`admin_api.notification_send_test` enqueues this form).
    await q(
      `select private.enqueue_job('notification', $1, $2::text::jsonb, $3::uuid, null, now(), 50, 5, null)`,
      [
        `notif:test:${crypto.randomUUID()}`,
        JSON.stringify({
          user_id: user.id,
          kind: 'test',
          detail_mode: 'generic',
          bypass_quiet_hours: false,
          admin_id: crypto.randomUUID(),
        }),
        user.id,
      ],
    );
    await run();
    const rows = await q<{
      decision: string;
      suppression_reason: string | null;
      scheduled_for: Date;
      is_test: boolean;
      title_rendered: string | null;
      category: string;
    }>(
      `select decision, suppression_reason, scheduled_for, is_test, title_rendered, category from public.notifications where user_id = $1 order by created_at`,
      [user.id],
    );
    const vipSent = rows.filter((r) => r.category === 'critical_email' && r.decision === 'sent');
    assertEquals(vipSent.length, 3, JSON.stringify(rows));
    const held = rows.filter((r) => r.decision === 'scheduled');
    assert(held.length >= 3, JSON.stringify(rows));
    for (const r of held) {
      assertEquals(r.suppression_reason, 'quiet_hours');
      assert(
        Math.abs(new Date(r.scheduled_for).getTime() - quietEnd.getTime()) < 60_000,
        `${String(r.scheduled_for)} vs ${quietEnd.toISOString()}`,
      );
    }
    const test = rows.find((r) => r.is_test);
    assert(test !== undefined && test.decision === 'scheduled', JSON.stringify(rows));
    for (const r of rows)
      if (r.decision !== 'sent') assert(r.suppression_reason !== null, JSON.stringify(r));
  },
);
