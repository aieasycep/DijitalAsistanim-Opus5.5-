/**
 * `supabaseNotificationsRepo` / `supabaseTriggerRepo` against a PostgREST double: the ledger's
 * `(user_id, dedupe_key)` uniqueness surfaces as `null` (IT-NTF-01), preference defaults and time
 * normalisation, live push targets minus per-device backoff (IT-NTF-04), category caps from
 * `app_settings`, and the trigger readers applying `user_overrides`.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { USER_A } from '../../testing/jwt.ts';
import { pgCount, pgError, postgrest } from '../../testing/postgrest.ts';
import type { NotificationInsert } from './model.ts';
import { notificationPrefsFrom, supabaseNotificationsRepo, supabaseTriggerRepo } from './repo.ts';

const N = '44444444-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-24T06:30:00.000Z');

Deno.test(
  'notifications repo (IT-NTF-01): a dedupe-key collision returns null instead of a second row',
  async () => {
    const row = {
      id: N,
      user_id: USER_A,
      category: 'deadline',
      decision: 'sent',
      dedupe_key: 'deadline:x',
    };
    let conflict = false;
    const pg = postgrest((req) => {
      if (req.method === 'POST')
        return conflict ? pgError('23505', 'duplicate key value', 409) : [row];
      if (req.method === 'PATCH') return undefined;
      return [row];
    });
    const repo = supabaseNotificationsRepo(pg.db);
    const insert = { user_id: USER_A, dedupe_key: 'deadline:x' } as unknown as NotificationInsert;
    assertEquals((await repo.insertNotification(insert))?.id, N);
    conflict = true;
    assertEquals(await repo.insertNotification(insert), null);
    assertEquals((await repo.findByDedupe(USER_A, 'deadline:x'))?.id, N);
    const find = pg.to('notifications', 'GET')[0]!;
    assertEquals(find.params, { user_id: `eq.${USER_A}`, dedupe_key: 'eq.deadline:x' });
    assertEquals((await repo.getNotification(USER_A, N))?.id, N);
    await repo.updateNotification(N, { decision: 'suppressed' } as never);
    assertEquals(pg.to('notifications', 'PATCH')[0]?.params.id, `eq.${N}`);

    const broken = postgrest(() => pgError('42501', 'permission denied', 403));
    const e = await assertRejects(() =>
      supabaseNotificationsRepo(broken.db).insertNotification(insert),
    );
    assert(e instanceof AppError && e.code === 'FORBIDDEN');
  },
);

Deno.test(
  'notifications repo: preferences default when absent; quiet times normalised to HH:MM',
  () => {
    const defaults = notificationPrefsFrom(null);
    assertEquals(
      [defaults.quiet_start, defaults.quiet_end, defaults.life_intel, defaults.detail_level],
      ['22:30', '07:30', false, 'title_only'],
    );
    const row = notificationPrefsFrom({
      quiet_start: '23:15:00',
      quiet_end: 'bad',
      morning: false,
    });
    assertEquals(
      [row.quiet_start, row.quiet_end, row.morning, row.midday],
      ['23:15', '07:30', false, true],
    );
  },
);

Deno.test(
  'notifications repo: user state combines zone, prefs, locale, Pro and OS permission',
  async () => {
    const state = (locale: string | null, permission: unknown, active: boolean) =>
      postgrest({
        'GET user_preferences': [{ timezone: 'Europe/Berlin' }],
        'GET notification_preferences': [
          { os_permission: permission, quiet_start: '22:00:00', quiet_end: '07:00:00' },
        ],
        'GET profiles': [{ locale }],
        'POST rpc/effective_entitlement': [{ is_active: active }],
      });
    const pro = await supabaseNotificationsRepo(state('en-GB', 'provisional', true).db).userState(
      USER_A,
    );
    assertEquals(
      [pro.timeZone, pro.locale, pro.isPro, pro.osPermission, pro.prefs.quiet_start],
      ['Europe/Berlin', 'en', true, 'provisional', '22:00'],
    );
    const free = await supabaseNotificationsRepo(state(null, 'weird', false).db).userState(USER_A);
    assertEquals([free.locale, free.isPro, free.osPermission], ['tr', false, 'undetermined']);

    const bare = postgrest({
      'GET user_preferences': [],
      'GET notification_preferences': [],
      'GET profiles': [],
      'POST rpc/effective_entitlement': [],
    });
    const none = await supabaseNotificationsRepo(bare.db).userState(USER_A);
    assertEquals([none.timeZone, none.isPro, none.prefs.daily_cap], ['Europe/Istanbul', false, 5]);
    assertEquals(bare.to('rpc/effective_entitlement')[0]?.body, { p_user_id: USER_A });
  },
);

Deno.test(
  'notifications repo (IT-NTF-04): push targets exclude signed-out installs and backed-off tokens',
  async () => {
    const pg = postgrest({
      'GET push_tokens': [
        {
          id: 't1',
          expo_push_token: 'ExponentPushToken[aaa]',
          installation_id: 'i1',
          app_installations: { id: 'i1', platform: 'ios', signed_out_at: null },
        },
        {
          id: 't2',
          expo_push_token: 'ExponentPushToken[bbb]',
          installation_id: 'i2',
          app_installations: { id: 'i2', platform: 'android', signed_out_at: null },
        },
        {
          id: 't3',
          expo_push_token: 'ExponentPushToken[ccc]',
          installation_id: 'i3',
          app_installations: {
            id: 'i3',
            platform: 'android',
            signed_out_at: '2026-09-01T00:00:00Z',
          },
        },
      ],
      'GET rate_limits': [{ key: 'push_backoff:t2' }],
    });
    const repo = supabaseNotificationsRepo(pg.db);
    assertEquals(await repo.activeTargets(USER_A, null, NOW), [
      { tokenId: 't1', token: 'ExponentPushToken[aaa]', platform: 'ios', installationRowId: 'i1' },
    ]);
    const tokens = pg.to('push_tokens')[0]!;
    assertEquals([tokens.params.status, tokens.params.installation_id], ['eq.active', undefined]);
    assert(tokens.select?.includes('app_installations!inner('));
    const backoff = pg.to('rate_limits')[0]!;
    assertEquals(backoff.params, {
      key: 'in.(push_backoff:t1,push_backoff:t2)',
      window_start: `gt.${NOW.toISOString()}`,
    });

    await repo.activeTargets(USER_A, 'i1', NOW);
    assertEquals(
      pg.to('push_tokens')[1]?.params.installation_id,
      'eq.i1',
      'a test push targets one installation',
    );

    const none = postgrest({ 'GET push_tokens': [] });
    assertEquals(await supabaseNotificationsRepo(none.db).activeTargets(USER_A, null, NOW), []);
    assertEquals(none.calls.length, 1, 'no backoff lookup without live tokens');
  },
);

Deno.test('notifications repo: recent sends, category caps and tickets', async () => {
  const pg = postgrest((req) => {
    switch (`${req.method} ${req.path}`) {
      case 'GET notifications':
        return [
          {
            category: 'deadline',
            sent_at: '2026-09-24T06:00:00Z',
            dedupe_key: 'd',
            is_test: false,
          },
        ];
      case 'GET app_settings':
        return [
          { key: 'notifications.cap.follow_up', value: 4 },
          { key: 'notifications.cap.deadline', value: '-1' },
          { key: 'notifications.cap.life_intel', value: '2.5' },
        ];
      case 'HEAD push_tickets':
        return pgCount(2);
      case 'POST push_tickets':
      case 'PATCH push_tickets':
      case 'PATCH push_tokens':
      case 'POST rate_limits':
      case 'POST system_health_checks':
        return undefined;
      case 'GET push_tickets':
        return [
          {
            id: 'pt1',
            expo_ticket_id: 'tk-1',
            push_token_id: 't1',
            sent_at: '2026-09-24T06:00:00Z',
          },
        ];
      default:
        return pgError('UNMATCHED', req.path, 500);
    }
  });
  const repo = supabaseNotificationsRepo(pg.db);
  const since = new Date('2026-09-23T06:30:00Z');
  assertEquals((await repo.recentSent(USER_A, since)).length, 1);
  const recent = pg.to('notifications')[0]!;
  assertEquals(
    [recent.params.decision, recent.params.sent_at, recent.params.limit],
    ['eq.sent', `gt.${since.toISOString()}`, '500'],
  );

  assertEquals(
    await repo.categoryCaps(),
    { follow_up: 4, life_intel: 3, deadline: 3 },
    'invalid overrides keep the default cap',
  );

  assertEquals(await repo.ticketCount(N), 2);
  await repo.insertTickets([]);
  assertEquals(pg.to('push_tickets', 'POST').length, 0);
  await repo.insertTickets([
    {
      notification_id: N,
      push_token_id: 't1',
      expo_ticket_id: 'tk-1',
      status: 'pending_receipt',
    } as never,
  ]);
  assertEquals((pg.to('push_tickets', 'POST')[0]?.body as unknown[]).length, 1);

  await repo.disableToken('t1', 'device_not_registered');
  assertEquals(pg.to('push_tokens', 'PATCH')[0]?.body, {
    status: 'disabled',
    disabled_reason: 'device_not_registered',
  });
  const until = new Date('2026-09-24T07:00:00Z');
  await repo.backoffToken('t1', until);
  const bo = pg.to('rate_limits', 'POST')[0]!;
  assertEquals(bo.body, { key: 'push_backoff:t1', window_start: until.toISOString(), count: 1 });
  assertEquals(bo.params.on_conflict, 'key,window_start');

  await repo.pendingTickets(NOW, 1000);
  await repo.pendingTickets(NOW, 10, ['tk-1']);
  const [all, some] = pg.to('push_tickets', 'GET');
  assertEquals(
    [all?.params.status, all?.params.expo_ticket_id, all?.params.limit],
    ['eq.pending_receipt', 'not.is.null', '1000'],
  );
  assertEquals(some?.params.expo_ticket_id, 'not.is.null&in.(tk-1)');

  await repo.resolveTicket('pt1', 'error', 'MessageRateExceeded', NOW);
  assertEquals(pg.to('push_tickets', 'PATCH')[0]?.body, {
    status: 'error',
    error_code: 'MessageRateExceeded',
    receipt_checked_at: NOW.toISOString(),
  });
  await repo.recordPushHealth('degraded', { errors: 3 } as never);
  assertEquals(pg.to('system_health_checks')[0]?.body, {
    component: 'push',
    status: 'degraded',
    detail: { errors: 3 },
    checked_by: 'cron',
  });
});

Deno.test(
  'trigger repo: event, prep topics, reminder with its notification category, status guards',
  async () => {
    const pg = postgrest((req) => {
      switch (`${req.method} ${req.path}`) {
        case 'GET calendar_events':
          return [{ id: 'e1', title: 'Yılmaz Endüstri görüşmesi' }];
        case 'GET meeting_preps':
          return [{ status: 'ready', talking_points: [{ text: 'Fiyat' }, { text: 'Teslim' }] }];
        case 'GET reminders':
          return req.params.id === 'eq.r1'
            ? [
                {
                  id: 'r1',
                  title: 'Faturayı öde',
                  remind_at: '2026-09-24T09:00:00Z',
                  channel: 'push',
                  status: 'scheduled',
                  notification_id: N,
                },
              ]
            : [
                {
                  id: 'r2',
                  title: 'Ara',
                  remind_at: '2026-09-24T09:00:00Z',
                  channel: 'local',
                  status: 'scheduled',
                  notification_id: null,
                },
              ];
        case 'GET notifications':
          return [{ category: 'deadline' }];
        case 'PATCH reminders':
        case 'PATCH briefings':
          return undefined;
        case 'GET approval_actions':
          return [{ id: 'a1', status: 'pending' }];
        case 'GET briefings':
          return [{ id: 'b1', kind: 'morning', status: 'ready' }];
        case 'GET subscriptions':
          return [];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const repo = supabaseTriggerRepo(pg.db);
    assertEquals(((await repo.event(USER_A, 'e1')) as { id: string } | null)?.id, 'e1');
    assertEquals(await repo.meetingPrep(USER_A, 'e1'), { status: 'ready', topics: 2 });
    assertEquals((await repo.reminder(USER_A, 'r1'))?.notification_category, 'deadline');
    assertEquals((await repo.reminder(USER_A, 'r2'))?.notification_category, null);
    assertEquals(
      pg.to('notifications').length,
      1,
      'a reminder without a notification skips the lookup',
    );

    await repo.setReminderStatus(USER_A, 'r1', 'delivered', NOW);
    await repo.setReminderStatus(USER_A, 'r2', 'failed', NOW);
    const [delivered, cancelled] = pg.to('reminders', 'PATCH');
    assertEquals(delivered?.body, { status: 'delivered', delivered_at: NOW.toISOString() });
    assertEquals(cancelled?.body, { status: 'failed' });
    assertEquals(delivered?.params.status, 'eq.scheduled', 'only a scheduled reminder moves');

    assertEquals(((await repo.approval(USER_A, 'a1')) as { id: string } | null)?.id, 'a1');
    assertEquals(((await repo.briefing(USER_A, 'b1')) as { id: string } | null)?.id, 'b1');
    await repo.markBriefingDelivered(USER_A, 'b1', NOW);
    const mark = pg.to('briefings', 'PATCH')[0]!;
    assertEquals(
      [mark.body, mark.params.status],
      [{ status: 'delivered', delivered_at: NOW.toISOString() }, 'eq.ready'],
    );
    assertEquals(await repo.subscription(USER_A), null);
    for (const c of pg.calls.filter((x) => x.path !== 'notifications'))
      assertEquals(c.params.user_id, `eq.${USER_A}`, c.path);
  },
);

Deno.test(
  'trigger repo: insights apply user overrides and name the other thread participant',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'insights') {
        return req.params.id === 'eq.i1'
          ? [
              {
                id: 'i1',
                kind: 'reply_needed',
                status: 'open',
                title: 'Özgün başlık',
                urgency: 'today',
                entity_type: 'email_thread',
                entity_id: 't1',
                due_at: '2026-09-25T09:00:00Z',
                event_at: null,
                created_at: '2026-09-24T06:00:00Z',
                user_overrides: {
                  title: { value: 'Teklife dön' },
                  due_at: { value: '2026-09-26T09:00:00Z' },
                },
              },
            ]
          : req.params.id === 'eq.i2'
            ? [
                {
                  id: 'i2',
                  kind: 'deadline',
                  status: 'open',
                  title: 'KDV',
                  urgency: 'normal',
                  entity_type: 'task',
                  entity_id: 'k1',
                  due_at: null,
                  event_at: null,
                  created_at: '2026-09-24T06:00:00Z',
                  user_overrides: null,
                },
              ]
            : [];
      }
      if (req.path === 'meeting_preps') return [];
      return [
        {
          participants: [
            { name: 'Yunus', email: 'yunus@firma.example', is_self: true },
            { email: 'noname@x.example' },
            { name: 'Mehmet Yılmaz', email: 'mehmet@yilmazendustri.example' },
          ],
        },
      ];
    });
    const repo = supabaseTriggerRepo(pg.db);
    const i1 = await repo.insight(USER_A, 'i1');
    assertEquals(
      [i1?.title, i1?.due_at, i1?.person],
      ['Teklife dön', '2026-09-26T09:00:00Z', 'Mehmet Yılmaz'],
    );
    const i2 = await repo.insight(USER_A, 'i2');
    assertEquals([i2?.title, i2?.person], ['KDV', null]);
    assertEquals(pg.to('email_threads').length, 1, 'only thread insights look up a person');
    assertEquals(await repo.insight(USER_A, 'missing'), null);
    assertEquals(await repo.meetingPrep(USER_A, 'none'), null);
  },
);
