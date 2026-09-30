/**
 * The server analytics emitter (API_CONTRACTS §17.1; SECURITY_AND_PRIVACY_PLAN §4.9): only the
 * backend events of the catalogue, typed and allow-listed props (a refused prop drops the whole
 * event), no content, the opt-out honoured, and a storage failure never reaching the caller.
 */
import { assertEquals } from '@std/assert';
import { ANALYTICS_EVENTS } from '@da/domain';
import { createLogger, memorySink } from '../../logging/logger.ts';
import { pgError, postgrest } from '../../testing/postgrest.ts';
import { memoryServerAnalytics } from '../../testing/analytics.ts';
import { createServerAnalytics, SERVER_ANALYTICS_EVENTS, supabaseServerAnalytics } from './emit.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const USER = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const INSTALLATION = '0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';

Deno.test('§17.1: the emitter covers exactly the server and shared events of the catalogue', () => {
  const catalogue = Object.entries(ANALYTICS_EVENTS)
    .filter(([, spec]) => spec.source === 'server' || spec.source === 'both')
    .map(([name]) => name)
    .sort();
  assertEquals([...SERVER_ANALYTICS_EVENTS].sort(), catalogue);
});

Deno.test(
  'a valid event is stored content-free with the request context and no session',
  async () => {
    const mem = memoryServerAnalytics({ now: () => NOW });
    const outcome = await mem.analytics.emit(
      'device_registered',
      { platform: 'ios', push_permission: 'granted' },
      { userId: USER, installationId: INSTALLATION, platform: 'ios', appVersion: '1.4.0' },
    );
    assertEquals(outcome, 'stored');
    assertEquals(mem.rows, [
      {
        user_id: USER,
        installation_id: INSTALLATION,
        session_id: null,
        event_name: 'device_registered',
        props: { platform: 'ios', push_permission: 'granted' },
        platform: 'ios',
        app_version: '1.4.0',
        occurred_at: NOW.toISOString(),
      },
    ]);
  },
);

Deno.test('a refused prop drops the whole event and logs only the reason', async () => {
  const log = memorySink();
  const mem = memoryServerAnalytics({ log: createLogger({ fn: 'test', sink: log.sink }) });
  const leaks = [
    // e-mail-like and URL-like strings, a value outside the closed vocabulary, an unknown prop.
    { tone: 'ayse@example.com' },
    { tone: 'https://example.com' },
    { tone: 'sarcastic' },
    { tone: 'short', subject: 'Teklif' },
  ];
  for (const props of leaks) {
    assertEquals(
      await mem.analytics.emit('reply_draft_generated', props as never, { userId: USER }),
      'rejected',
    );
  }
  assertEquals(
    await mem.analytics.emit('evening_closed', { carried: -1 }, { userId: USER }),
    'rejected',
  );
  assertEquals(mem.rows.length, 0);
  const text = log.lines.join('\n');
  assertEquals(text.includes('ayse@example.com') || text.includes('Teklif'), false);
  assertEquals(
    log.records().filter((r) => r.msg === 'analytics_event_rejected').length,
    leaks.length + 1,
  );
});

Deno.test(
  'a client-only event name never reaches the table through the server emitter',
  async () => {
    const mem = memoryServerAnalytics();
    const outcome = await mem.analytics.emit('app_opened' as never, {} as never, { userId: USER });
    assertEquals([outcome, mem.rows.length], ['rejected', 0]);
  },
);

Deno.test('the analytics opt-out stops collection; an aggregate event has no user', async () => {
  const mem = memoryServerAnalytics();
  mem.optOut.add(USER);
  assertEquals(
    await mem.analytics.emit('weekly_share_card_served', {}, { userId: USER }),
    'opted_out',
  );
  assertEquals(await mem.analytics.emit('referral_link_opened', {}, { userId: null }), 'stored');
  assertEquals(
    mem.rows.map((r) => [r.event_name, r.user_id]),
    [['referral_link_opened', null]],
  );
});

Deno.test('a storage failure is logged by code and never thrown', async () => {
  const log = memorySink();
  const analytics = createServerAnalytics(
    {
      optedOut: () => Promise.resolve(false),
      insert: () =>
        Promise.reject(Object.assign(new Error('boom'), { code: 'SERVICE_UNAVAILABLE' })),
    },
    { log: createLogger({ fn: 'test', sink: log.sink }) },
  );
  assertEquals(
    await analytics.emit('capture_analyzed', { kind: 'pdf' }, { userId: USER }),
    'failed',
  );
  const failed = log.records().find((r) => r.msg === 'analytics_emit_failed');
  assertEquals([failed?.event, failed?.error_code], ['capture_analyzed', 'SERVICE_UNAVAILABLE']);
});

Deno.test(
  'supabase sink: reads the opt-out with the service client and inserts one row',
  async () => {
    const pg = postgrest({
      'GET user_preferences': [{ analytics_opt_out: false }],
      'POST analytics_events': undefined,
    });
    const analytics = supabaseServerAnalytics(
      pg.db,
      createLogger({ fn: 'test', sink: memorySink().sink }),
    );
    assertEquals(
      await analytics.emit(
        'search_performed',
        { mode: 'hybrid', result_count: 4 },
        { userId: USER },
      ),
      'stored',
    );
    assertEquals(pg.to('user_preferences')[0]?.params.user_id, `eq.${USER}`);
    const body = pg.to('analytics_events', 'POST')[0]?.body as Record<string, unknown>;
    assertEquals(
      [body.event_name, body.props, body.session_id, body.user_id],
      ['search_performed', { mode: 'hybrid', result_count: 4 }, null, USER],
    );

    const optedOut = postgrest({ 'GET user_preferences': [{ analytics_opt_out: true }] });
    const quiet = supabaseServerAnalytics(
      optedOut.db,
      createLogger({ fn: 'test', sink: memorySink().sink }),
    );
    assertEquals(await quiet.emit('evening_closed', { carried: 2 }, { userId: USER }), 'opted_out');
    assertEquals(optedOut.to('analytics_events').length, 0);

    const broken = postgrest({
      'GET user_preferences': [],
      'POST analytics_events': pgError('23514', 'check violation'),
    });
    const failing = supabaseServerAnalytics(
      broken.db,
      createLogger({ fn: 'test', sink: memorySink().sink }),
    );
    assertEquals(await failing.emit('weekly_share_card_served', {}, { userId: USER }), 'failed');
  },
);
