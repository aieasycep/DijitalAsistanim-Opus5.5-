import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_CALENDAR_STALE_MINUTES,
  deviceScheduleCanonical,
  isDeviceSyncStale,
  parseDeviceCalendarFreshness,
} from '../../src/calendar/device-freshness.ts';

/**
 * The shared vector (also asserted by the Edge briefing test and the app's Jest suite): the same
 * events spelled the PostgREST way and the JavaScript way hash to the same fingerprint.
 */
const VECTOR = {
  events: [
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
  ],
  sha256: '3b72688e0c1f380a80394375f7db58f99ff10af5b95ef837f9f94f54eca80f80',
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('device calendar freshness (KPL-12)', () => {
  it('is stale after 180 minutes or without any sync', () => {
    const at = new Date('2026-09-30T05:00:00Z');
    expect(DEVICE_CALENDAR_STALE_MINUTES).toBe(180);
    expect(isDeviceSyncStale('2026-09-30T02:00:00Z', at)).toBe(false);
    expect(isDeviceSyncStale('2026-09-30T01:59:00Z', at)).toBe(true);
    expect(isDeviceSyncStale(null, at)).toBe(true);
    expect(isDeviceSyncStale('not a date', at)).toBe(true);
  });

  it('builds an order- and spelling-independent fingerprint input', () => {
    const canonical = deviceScheduleCanonical(VECTOR.events);
    expect(canonical).toBe(
      'a0000000-0000-4000-8000-000000000001|1790737200000|1790739000000|tentative\n' +
        'a0000000-0000-4000-8000-000000000002|1790744400000|1790748000000|confirmed',
    );
    expect(sha256(canonical)).toBe(VECTOR.sha256);
    const respelled = [...VECTOR.events].reverse().map((e) => ({
      ...e,
      start_at: new Date(e.start_at).toISOString(),
      end_at: new Date(e.end_at).toISOString(),
    }));
    expect(deviceScheduleCanonical(respelled)).toBe(canonical);
    // A moved event, a cancelled event or a removed event changes it; nothing else does.
    const moved = VECTOR.events.map((e, i) =>
      i === 0 ? { ...e, start_at: '2026-09-30T05:30:00Z' } : e,
    );
    expect(deviceScheduleCanonical(moved)).not.toBe(canonical);
    const cancelled = VECTOR.events.map((e, i) => (i === 0 ? { ...e, status: 'cancelled' } : e));
    expect(deviceScheduleCanonical(cancelled)).not.toBe(canonical);
    expect(deviceScheduleCanonical(VECTOR.events.slice(1))).not.toBe(canonical);
    expect(deviceScheduleCanonical([])).toBe('');
  });

  it('parses the stored object defensively', () => {
    expect(parseDeviceCalendarFreshness(null)).toBeNull();
    expect(parseDeviceCalendarFreshness({ sources: [] })).toBeNull();
    expect(
      parseDeviceCalendarFreshness({
        sources: [
          { provider: 'apple_device', last_sync_at: '2026-09-30T01:00:00Z', stale: true },
          { provider: 'google', last_sync_at: null, stale: true },
          'x',
        ],
        window_start: '2026-09-29T21:00:00.000Z',
        window_end: '2026-09-30T21:00:00.000Z',
        fingerprint: VECTOR.sha256,
      }),
    ).toEqual({
      sources: [{ provider: 'apple_device', last_sync_at: '2026-09-30T01:00:00Z', stale: true }],
      window_start: '2026-09-29T21:00:00.000Z',
      window_end: '2026-09-30T21:00:00.000Z',
      fingerprint: VECTOR.sha256,
      event_count: 0,
    });
  });
});
