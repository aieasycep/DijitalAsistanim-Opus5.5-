/**
 * KPL-11 / KPL-12 device-calendar refresh before a briefing: which installations are nudged, the
 * notification job key, the recorded freshness and its fingerprint (the shared vector of
 * `packages/domain/test/calendar/device-freshness.test.ts` and the app's Jest suite), and the
 * `deviceSchedule` store read.
 */
import { assertEquals } from '@std/assert';
import { USER_A } from '../../testing/jwt.ts';
import { postgrest } from '../../testing/postgrest.ts';
import { supabaseStatsStore } from '../intel/supabase-store.ts';
import {
  DEVICE_REFRESH_AFTER_MINUTES,
  deviceCalendarFreshness,
  deviceRefreshJob,
  type DeviceSchedule,
  type DeviceSource,
  needsRefresh,
  refreshTargets,
} from './device-refresh.ts';

const NOW = new Date('2026-09-30T05:30:00.000Z'); // 08:30 Europe/Istanbul
const INSTALL = 'bbbbbbbb-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

/** The cross-runtime vector: the same instants spelled the PostgREST and the JavaScript way. */
const VECTOR_EVENTS = [
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    start_at: '2026-09-30T05:00:00+00:00',
    end_at: '2026-09-30T06:00:00+00:00',
    status: 'confirmed',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    start_at: '2026-09-30T03:00:00.000Z',
    end_at: '2026-09-30T03:30:00.000Z',
    status: 'tentative',
  },
];
const VECTOR_SHA256 = '3b72688e0c1f380a80394375f7db58f99ff10af5b95ef837f9f94f54eca80f80';

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function source(over: Partial<DeviceSource> = {}): DeviceSource {
  return {
    accountId: 'cccccccc-0000-4000-8000-000000000001',
    provider: 'apple_device',
    installationRowId: INSTALL,
    lastSyncAt: minutesAgo(90),
    ...over,
  };
}

Deno.test('device refresh: sources older than 30 minutes (or never synced) are nudged', () => {
  assertEquals(DEVICE_REFRESH_AFTER_MINUTES, 30);
  assertEquals(needsRefresh(source({ lastSyncAt: minutesAgo(29) }), NOW), false);
  assertEquals(needsRefresh(source({ lastSyncAt: minutesAgo(31) }), NOW), true);
  assertEquals(needsRefresh(source({ lastSyncAt: null }), NOW), true);
  const schedule: DeviceSchedule = {
    sources: [
      source(),
      // The same installation twice (Apple Takvim + a second account) is nudged once.
      source({ accountId: 'cccccccc-0000-4000-8000-000000000002' }),
      source({ installationRowId: OTHER, lastSyncAt: minutesAgo(5) }),
      // Signed out: no installation to wake.
      source({ installationRowId: null, lastSyncAt: null }),
    ],
    events: [],
  };
  assertEquals(refreshTargets(schedule, NOW), [INSTALL]);
});

Deno.test(
  'device refresh: one notification job per installation, kind and local date (payload.kind)',
  () => {
    assertEquals(deviceRefreshJob(USER_A, INSTALL, 'morning', '2026-09-30'), {
      type: 'notification',
      idempotencyKey: `device_refresh:${INSTALL}:morning:2026-09-30`,
      payload: { user_id: USER_A, kind: 'device_refresh', installation_id: INSTALL },
      userId: USER_A,
      priority: 10,
      maxAttempts: 3,
    });
  },
);

Deno.test(
  'device freshness: per-source staleness (180 min), window and the shared fingerprint vector',
  async () => {
    const window = {
      from: new Date('2026-09-29T21:00:00.000Z'),
      to: new Date('2026-09-30T21:00:00.000Z'),
    };
    const freshness = await deviceCalendarFreshness(
      {
        sources: [
          source({ lastSyncAt: minutesAgo(179) }),
          source({
            provider: 'android_device',
            installationRowId: OTHER,
            lastSyncAt: minutesAgo(181),
          }),
        ],
        events: VECTOR_EVENTS,
      },
      window,
      NOW,
    );
    assertEquals(freshness, {
      sources: [
        { provider: 'apple_device', last_sync_at: minutesAgo(179), stale: false },
        { provider: 'android_device', last_sync_at: minutesAgo(181), stale: true },
      ],
      window_start: '2026-09-29T21:00:00.000Z',
      window_end: '2026-09-30T21:00:00.000Z',
      fingerprint: VECTOR_SHA256,
      event_count: 2,
    });
    assertEquals(await deviceCalendarFreshness({ sources: [], events: [] }, window, NOW), null);
  },
);

Deno.test(
  'intel stats store: deviceSchedule reads active device accounts, their installation and window events',
  async () => {
    const pg = postgrest((req) => {
      switch (req.path) {
        case 'connected_accounts':
          return [
            {
              id: 'cccccccc-0000-4000-8000-000000000001',
              provider: 'apple_device',
              provider_account_id: 'dddddddd-0000-4000-8000-000000000001',
              last_successful_sync_at: '2026-09-30T04:00:00+00:00',
            },
          ];
        case 'app_installations':
          return [{ id: INSTALL, installation_id: 'dddddddd-0000-4000-8000-000000000001' }];
        case 'calendar_events':
          return VECTOR_EVENTS;
        default:
          return [];
      }
    });
    const from = new Date('2026-09-29T21:00:00.000Z');
    const to = new Date('2026-09-30T21:00:00.000Z');
    const schedule = await supabaseStatsStore(pg.db).deviceSchedule!(USER_A, from, to);
    assertEquals(schedule.sources, [
      {
        accountId: 'cccccccc-0000-4000-8000-000000000001',
        provider: 'apple_device',
        installationRowId: INSTALL,
        lastSyncAt: '2026-09-30T04:00:00+00:00',
      },
    ]);
    assertEquals(schedule.events.length, 2);
    const accounts = pg.to('connected_accounts')[0]!;
    assertEquals(accounts.params.user_id, `eq.${USER_A}`);
    assertEquals(accounts.params.provider, 'in.(apple_device,android_device)');
    assertEquals(accounts.params.disconnected_at, 'is.null');
    const installs = pg.to('app_installations')[0]!;
    assertEquals(installs.params.signed_out_at, 'is.null');
    assertEquals(installs.params.installation_id, 'in.(dddddddd-0000-4000-8000-000000000001)');
    const events = pg.to('calendar_events')[0]!;
    assertEquals(events.select, 'id,start_at,end_at,status');
    assertEquals(events.params.connected_account_id, 'in.(cccccccc-0000-4000-8000-000000000001)');
    assertEquals(events.params.provider_deleted_at, 'is.null');
    assertEquals(events.params.start_at, `lt.${to.toISOString()}`);
    assertEquals(events.params.end_at, `gt.${from.toISOString()}`);

    // No device calendar: nothing else is read.
    const empty = postgrest(() => []);
    assertEquals(await supabaseStatsStore(empty.db).deviceSchedule!(USER_A, from, to), {
      sources: [],
      events: [],
    });
    assertEquals(empty.calls.length, 1);
  },
);
