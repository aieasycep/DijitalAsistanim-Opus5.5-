import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { calendarDaysBetween, formatRelativeDay, formatTimeAgo } from '../src/relative-time.ts';

// "Now" = Saturday 5 September 2026, 12:00 in Istanbul (09:00 UTC).
const NOW = new Date(Date.UTC(2026, 8, 5, 9, 0));
const at = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 8, day, hour - 3, minute));

describe('formatTimeAgo (date-fns formatDistance)', () => {
  it('formats past instants in Turkish', () => {
    expect(formatTimeAgo(at(2, 12), { now: NOW })).toBe('3 gün önce');
    expect(formatTimeAgo(new Date(NOW.getTime() - 5 * 60_000), { now: NOW })).toBe('5 dakika önce');
    expect(formatTimeAgo(new Date(NOW.getTime() - 2 * 3_600_000), { now: NOW })).toBe(
      'yaklaşık 2 saat önce',
    );
  });

  it('formats past instants in English', () => {
    expect(formatTimeAgo(at(2, 12), { now: NOW, locale: 'en' })).toBe('3 days ago');
    expect(formatTimeAgo(new Date(NOW.getTime() - 5 * 60_000), { now: NOW, locale: 'en' })).toBe(
      '5 minutes ago',
    );
  });

  it('formats future instants and bare distances', () => {
    expect(formatTimeAgo(new Date(NOW.getTime() + 20 * 60_000), { now: NOW })).toBe(
      '20 dakika sonra',
    );
    expect(formatTimeAgo(new Date(NOW.getTime() + 20 * 60_000), { now: NOW, locale: 'en' })).toBe(
      'in 20 minutes',
    );
    expect(formatTimeAgo(at(2, 12), { now: NOW, addSuffix: false })).toBe('3 gün');
  });
});

describe('formatRelativeDay (date-fns formatRelative, 24-hour)', () => {
  it('labels today, yesterday and tomorrow', () => {
    expect(formatRelativeDay(at(5, 9, 40), { now: NOW })).toBe('Bugün 09:40');
    expect(formatRelativeDay(at(4, 15, 40), { now: NOW })).toBe('Dün 15:40');
    expect(formatRelativeDay(at(6, 9, 15), { now: NOW })).toBe('Yarın 09:15');
    expect(formatRelativeDay(at(4, 15, 40), { now: NOW, locale: 'en' })).toBe('Yesterday 15:40');
    expect(formatRelativeDay(at(6, 21, 15), { now: NOW, locale: 'en' })).toBe('Tomorrow 21:15');
  });

  it('uses the weekday within a week and a date beyond it', () => {
    expect(formatRelativeDay(at(7, 10), { now: NOW })).toBe('Pazartesi 10:00');
    expect(formatRelativeDay(at(2, 10), { now: NOW, locale: 'en' })).toBe('Wednesday 10:00');
    expect(formatRelativeDay(at(20, 10), { now: NOW })).toBe('20 Eylül');
    expect(formatRelativeDay(new Date(Date.UTC(2025, 11, 1, 9)), { now: NOW })).toBe(
      '1 Aralık 2025',
    );
  });

  it('draws day boundaries in the given time zone', () => {
    const instant = new Date(Date.UTC(2026, 8, 4, 22, 30)); // 01:30 on 5 Sep in Istanbul, 4 Sep in UTC
    expect(formatRelativeDay(instant, { now: NOW })).toBe('Bugün 01:30');
    expect(formatRelativeDay(instant, { now: NOW, timeZone: 'UTC' })).toBe('Dün 22:30');
  });
});

describe('calendarDaysBetween', () => {
  it('counts calendar days in the zone', () => {
    expect(calendarDaysBetween(at(2, 23), NOW)).toBe(3);
    expect(calendarDaysBetween(new Date(Date.UTC(2026, 8, 4, 22, 30)), NOW)).toBe(0);
    expect(calendarDaysBetween(new Date(Date.UTC(2026, 8, 4, 22, 30)), NOW, 'UTC')).toBe(1);
  });
});

describe('Hermes compatibility', () => {
  it('never calls Intl.RelativeTimeFormat', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/relative-time.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/new\s+Intl\.RelativeTimeFormat/);
  });
});
