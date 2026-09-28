/**
 * JOB-14 `briefing` with device calendars (KPL-11, KPL-12): a scheduled morning briefing whose
 * device source has not synced for 30 minutes sends the `device_refresh` push to the uploading
 * installation and runs once more 3 minutes later; the generated briefing records
 * `source_freshness.device_calendar` (per-source staleness, window, fingerprint). Manual retries,
 * fresh sources and signed-out installations generate at once.
 */
import { assert, assertEquals } from '@std/assert';
import { USER_A } from '../../_shared/testing/jwt.ts';
import {
  briefingRow,
  fixtureServices,
  jobContext,
  MemoryIntel,
  NOW,
} from '../../_shared/testing/intel.ts';
import type { DeviceSchedule } from '../../_shared/services/briefings/device-refresh.ts';
import type { IntelDeps } from './intel.ts';
import { runBriefing, scheduleWindow } from './briefing.ts';

const INSTALL = 'bbbbbbbb-0000-4000-8000-000000000001';
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function deps(mem: MemoryIntel, schedule: () => DeviceSchedule | null): IntelDeps {
  const ai = fixtureServices();
  const stats = mem.statsStore();
  return {
    ai: ai.services,
    mail: mem.mailStore(),
    insights: {
      snapshot: () => Promise.resolve(mem.snapshot()),
      upsertInsights: (rows) => mem.upsertInsights(rows),
      expireInsights: () => Promise.resolve(),
      updateThreads: () => Promise.resolve(),
    },
    briefings: mem.briefingStore(),
    stats: {
      ...stats,
      deviceSchedule: () => {
        const value = schedule();
        return value === null ? Promise.reject(new Error('unused')) : Promise.resolve(value);
      },
    },
    memory: mem.memoryStore(),
    bodies: mem.bodySource(),
    reconciliation: {
      env: {},
      fetch: () => Promise.reject(new Error('no network')),
      costByModel: () => Promise.resolve([]),
      recordHealth: () => Promise.resolve(),
      audit: { append: () => Promise.resolve() },
    },
  };
}

function schedule(lastSyncAt: string | null, installationRowId: string | null = INSTALL) {
  return (): DeviceSchedule => ({
    sources: [
      {
        accountId: 'cccccccc-0000-4000-8000-000000000001',
        provider: 'apple_device',
        installationRowId,
        lastSyncAt,
      },
    ],
    events: [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        start_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
        end_at: new Date(NOW.getTime() + 5_400_000).toISOString(),
        status: 'confirmed',
      },
    ],
  });
}

function stored(mem: MemoryIntel, id: string): Record<string, unknown> {
  return mem.briefings.find((b) => b.id === id) as unknown as Record<string, unknown>;
}

Deno.test(
  'a stale device calendar is refreshed before the morning briefing, which runs once 3 minutes later',
  async () => {
    const mem = new MemoryIntel();
    const morning = briefingRow();
    mem.briefings.push(morning);
    let lastSync = minutesAgo(200);
    const d = deps(mem, () => schedule(lastSync)());

    const first = jobContext({ briefing_id: morning.id }, { type: 'briefing' });
    const deferred = await runBriefing(d, first);
    assertEquals(deferred, {
      briefing_id: morning.id,
      status: 'scheduled',
      deferred: 'device_refresh',
      refresh_pushes: 1,
    });
    assertEquals(stored(mem, morning.id).status, 'scheduled');
    const push = first.enqueued.find((j) => j.type === 'notification');
    assertEquals(push?.idempotencyKey, `device_refresh:${INSTALL}:morning:2026-09-24`);
    assertEquals(push?.payload, {
      user_id: USER_A,
      kind: 'device_refresh',
      installation_id: INSTALL,
    });
    const again = first.enqueued.find((j) => j.type === 'briefing');
    assertEquals(again?.idempotencyKey, `briefing:${morning.id}:after_device_refresh`);
    assertEquals(again?.payload, { briefing_id: morning.id, after_device_refresh: true });
    assertEquals(again?.runAfter?.getTime(), NOW.getTime() + 3 * 60_000);

    // The device uploaded in the meantime: the delayed run generates and records the freshness.
    lastSync = minutesAgo(-2);
    const later = new Date(NOW.getTime() + 3 * 60_000);
    const second = jobContext(
      { briefing_id: morning.id, after_device_refresh: true },
      { type: 'briefing', now: later },
    );
    const done = await runBriefing(d, second);
    assertEquals(done.status, 'ready');
    assertEquals(
      second.enqueued.filter((j) => j.idempotencyKey.startsWith('device_refresh')),
      [],
    );
    const freshness = (stored(mem, morning.id).source_freshness as Record<string, unknown>)
      .device_calendar as Record<string, unknown>;
    assertEquals(freshness.sources, [
      { provider: 'apple_device', last_sync_at: lastSync, stale: false },
    ]);
    // Europe/Istanbul day of 2026-09-24.
    assertEquals(freshness.window_start, '2026-09-23T21:00:00.000Z');
    assertEquals(freshness.window_end, '2026-09-24T21:00:00.000Z');
    assertEquals(freshness.event_count, 1);
    assert(/^[a-f0-9]{64}$/.test(String(freshness.fingerprint)));
    // The account freshness written by the morning composer is kept.
    assert('accounts' in (stored(mem, morning.id).source_freshness as Record<string, unknown>));
  },
);

Deno.test(
  'the delayed run never defers again and records a still-stale source (no upload arrived)',
  async () => {
    const mem = new MemoryIntel();
    const morning = briefingRow();
    mem.briefings.push(morning);
    const d = deps(mem, schedule(minutesAgo(200)));
    const ctx = jobContext(
      { briefing_id: morning.id, after_device_refresh: true },
      { type: 'briefing' },
    );
    assertEquals((await runBriefing(d, ctx)).status, 'ready');
    const device = (stored(mem, morning.id).source_freshness as Record<string, unknown>)
      .device_calendar as { sources: { stale: boolean }[] };
    assertEquals(device.sources[0]?.stale, true);
  },
);

Deno.test(
  'fresh sources, signed-out installations and manual retries generate at once',
  async () => {
    for (const [label, make, origin] of [
      ['fresh', schedule(minutesAgo(10)), 'scheduled'],
      ['signed out', schedule(minutesAgo(200), null), 'scheduled'],
      ['retry', schedule(minutesAgo(200)), 'retry'],
    ] as const) {
      const mem = new MemoryIntel();
      const morning = briefingRow({ origin });
      mem.briefings.push(morning);
      const ctx = jobContext({ briefing_id: morning.id }, { type: 'briefing' });
      const result = await runBriefing(deps(mem, make), ctx);
      assertEquals(result.status, 'ready', label);
      assertEquals(
        ctx.enqueued.filter((j) => j.idempotencyKey.startsWith('device_refresh')).length,
        0,
        label,
      );
    }
  },
);

Deno.test('the schedule window is the day (morning) or tomorrow (evening); none otherwise', () => {
  const tz = 'Europe/Istanbul';
  const morning = scheduleWindow(briefingRow(), tz);
  assertEquals(morning?.from.toISOString(), '2026-09-23T21:00:00.000Z');
  const evening = scheduleWindow(briefingRow({ kind: 'evening' }), tz);
  assertEquals(
    [evening?.from.toISOString(), evening?.to.toISOString()],
    ['2026-09-24T21:00:00.000Z', '2026-09-25T21:00:00.000Z'],
  );
  assertEquals(scheduleWindow(briefingRow({ kind: 'midday' }), tz), null);
  assertEquals(scheduleWindow(briefingRow({ kind: 'weekly' }), tz), null);
});

Deno.test('without device data the briefing records no device_calendar freshness', async () => {
  const mem = new MemoryIntel();
  const morning = briefingRow();
  mem.briefings.push(morning);
  const ctx = jobContext({ briefing_id: morning.id }, { type: 'briefing' });
  const result = await runBriefing(
    deps(mem, () => ({ sources: [], events: [] })),
    ctx,
  );
  assertEquals(result.status, 'ready');
  const freshness = stored(mem, morning.id).source_freshness as Record<string, unknown>;
  assertEquals('device_calendar' in freshness, false);
});
