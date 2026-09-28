/**
 * KPL-36: the app's "outside the sync window" note (`calendarSyncWindow` in @da/domain) and the
 * Edge calendar sync (`calendarWindow`) keep the same window for every server-synced provider.
 */
import { assertEquals } from '@std/assert';
import { calendarSyncWindow } from '@da/domain';
import { calendarWindow } from './sync-calendar.ts';

Deno.test('calendar sync window: the Edge sync and the shared domain bounds agree', () => {
  const now = new Date('2026-09-28T09:00:00.000Z');
  for (const provider of ['google', 'microsoft', 'demo'] as const) {
    const shared = calendarSyncWindow(provider, now);
    assertEquals(calendarWindow(provider, now), {
      start: shared.start.toISOString(),
      end: shared.end.toISOString(),
    });
  }
});
