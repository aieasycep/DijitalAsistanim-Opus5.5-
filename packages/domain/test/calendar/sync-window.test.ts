import { describe, expect, it } from 'vitest';

import {
  CALENDAR_SYNC_WINDOW_DAYS,
  beyondSyncWindow,
  calendarSyncWindow,
} from '../../src/calendar/sync-window.ts';
import { PROVIDER_VALUES } from '../../src/enums.ts';

const NOW = new Date('2026-09-28T09:00:00.000Z');
const DAY = 86_400_000;

describe('calendarSyncWindow', () => {
  it('keeps a window for every provider', () => {
    for (const provider of PROVIDER_VALUES) {
      expect(CALENDAR_SYNC_WINDOW_DAYS[provider].after).toBeGreaterThan(0);
    }
  });

  it('spans the provider days around now', () => {
    expect(calendarSyncWindow('microsoft', NOW)).toEqual({
      start: new Date(NOW.getTime() - 2 * DAY),
      end: new Date(NOW.getTime() + 60 * DAY),
    });
    expect(calendarSyncWindow('google', NOW).end).toEqual(new Date(NOW.getTime() + 365 * DAY));
    expect(calendarSyncWindow('apple_device', NOW).start).toEqual(new Date(NOW.getTime() - DAY));
  });
});

describe('beyondSyncWindow', () => {
  const dayStart = (daysAhead: number) => new Date(NOW.getTime() + daysAhead * DAY);

  it('flags a day wholly past any provider window', () => {
    expect(beyondSyncWindow(['google', 'microsoft'], dayStart(61), NOW)).toBe(true);
    expect(beyondSyncWindow(['android_device'], dayStart(14), NOW)).toBe(true);
  });

  it('leaves days inside every window and past days alone', () => {
    expect(beyondSyncWindow(['google', 'microsoft'], dayStart(59), NOW)).toBe(false);
    expect(beyondSyncWindow(['microsoft'], dayStart(-10), NOW)).toBe(false);
    expect(beyondSyncWindow([], dayStart(400), NOW)).toBe(false);
  });
});
