import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIME_ZONE,
  audioMinutes,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatDuration,
  formatFileSize,
  formatNumber,
  formatPercent,
  formatTime,
  formatTimeRange,
  formatWeekdayDate,
  toLocalDateString,
  toZonedDate,
  zonedClock,
} from '../src/formats.ts';

// 2026-09-05 06:40 UTC = 09:40 in Istanbul (UTC+3, no DST since 2016).
const MORNING = new Date(Date.UTC(2026, 8, 5, 6, 40));
// 2026-09-05 14:05 UTC = 17:05 Istanbul.
const AFTERNOON = new Date(Date.UTC(2026, 8, 5, 14, 5));

describe('time zone', () => {
  it('defaults to Europe/Istanbul', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Europe/Istanbul');
    expect(formatTime(MORNING)).toBe('09:40');
  });

  it('formats in the zone passed as a parameter, not the host zone', () => {
    expect(formatTime(MORNING, { timeZone: 'UTC' })).toBe('06:40');
    expect(formatTime(MORNING, { timeZone: 'America/New_York' })).toBe('02:40');
    expect(formatTime(MORNING, { timeZone: 'Asia/Tokyo' })).toBe('15:40');
  });

  it('computes the local calendar date per zone', () => {
    const lateUtc = new Date(Date.UTC(2026, 8, 5, 22, 30)); // 01:30 on 6 Sep in Istanbul
    expect(toLocalDateString(lateUtc)).toBe('2026-09-06');
    expect(toLocalDateString(lateUtc, 'UTC')).toBe('2026-09-05');
    expect(zonedClock(lateUtc)).toEqual({ hours: 1, minutes: 30 });
  });

  it('handles DST zones (Europe/Berlin switches on 25 October 2026)', () => {
    const beforeSwitch = new Date(Date.UTC(2026, 9, 24, 10, 0));
    const afterSwitch = new Date(Date.UTC(2026, 9, 26, 10, 0));
    expect(formatTime(beforeSwitch, { timeZone: 'Europe/Berlin' })).toBe('12:00');
    expect(formatTime(afterSwitch, { timeZone: 'Europe/Berlin' })).toBe('11:00');
  });

  it('accepts ISO strings and epoch milliseconds and rejects invalid input', () => {
    expect(formatTime('2026-09-05T06:40:00Z')).toBe('09:40');
    expect(formatTime(MORNING.getTime())).toBe('09:40');
    expect(toZonedDate(MORNING).getHours()).toBe(9);
    expect(() => formatTime('not a date')).toThrow(RangeError);
  });
});

describe('24-hour clock and `d MMMM yyyy` dates', () => {
  it('never uses a 12-hour clock', () => {
    expect(formatTime(AFTERNOON, { locale: 'tr' })).toBe('17:05');
    expect(formatTime(AFTERNOON, { locale: 'en' })).toBe('17:05');
    expect(formatTime(AFTERNOON, { locale: 'en' })).not.toMatch(/AM|PM/i);
  });

  it('formats dates in Turkish and English', () => {
    expect(formatDate(MORNING, { locale: 'tr' })).toBe('5 Eylül 2026');
    expect(formatDate(MORNING, { locale: 'en' })).toBe('5 September 2026');
    expect(formatDayMonth(MORNING, { locale: 'tr' })).toBe('5 Eylül');
    expect(formatWeekdayDate(MORNING, { locale: 'tr' })).toBe('5 Eylül Cumartesi');
    expect(formatWeekdayDate(MORNING, { locale: 'en' })).toBe('Saturday 5 September');
    expect(formatDateTime(MORNING, { locale: 'tr' })).toBe('5 Eylül 2026 09:40');
    expect(formatDateTime(MORNING, { locale: 'en' })).toBe('5 September 2026, 09:40');
  });

  it('formats time ranges with an en dash', () => {
    const end = new Date(Date.UTC(2026, 8, 5, 13, 30));
    expect(formatTimeRange(new Date(Date.UTC(2026, 8, 5, 11, 0)), end)).toBe('14:00–16:30');
  });
});

describe('numbers and currency', () => {
  it('formats TRY with Intl.NumberFormat("tr-TR", {style:"currency", currency:"TRY"})', () => {
    const expected = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
      1842,
    );
    expect(formatCurrency(1842, 'tr')).toBe(expected);
    expect(formatCurrency(1842, 'tr')).toBe('₺1.842,00');
    expect(formatCurrency(1842.5, 'tr')).toBe('₺1.842,50');
  });

  it('formats TRY for English with en-US conventions', () => {
    expect(formatCurrency(1842, 'en')).toMatch(/^TRY\s1,842\.00$/u);
  });

  it('can drop the fraction on whole amounts (pricing page)', () => {
    expect(formatCurrency(199, 'tr', { trimWholeFraction: true })).toBe('₺199');
    expect(formatCurrency(199.9, 'tr', { trimWholeFraction: true })).toBe('₺199,90');
  });

  it('formats other currencies on request', () => {
    expect(formatCurrency(10, 'en', { currency: 'USD' })).toBe('$10.00');
  });

  it('formats numbers and percentages per locale', () => {
    expect(formatNumber(1234567.5, 'tr')).toBe('1.234.567,5');
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
    expect(formatPercent(0.38, 'tr')).toBe('%38');
    expect(formatPercent(0.38, 'en')).toBe('38%');
  });

  it('formats file sizes', () => {
    expect(formatFileSize(1_250_000, 'tr')).toBe('1,3 MB');
    expect(formatFileSize(1_250_000, 'en')).toBe('1.3 MB');
    expect(formatFileSize(512, 'tr')).toBe('512 B');
    expect(formatFileSize(45_000_000, 'en')).toBe('45 MB');
  });
});

describe('durations', () => {
  it('formats compact durations', () => {
    expect(formatDuration(168, 'tr')).toBe('2 sa 48 dk');
    expect(formatDuration(168, 'en')).toBe('2 h 48 min');
    expect(formatDuration(45, 'tr')).toBe('45 dk');
    expect(formatDuration(120, 'tr')).toBe('2 sa');
    expect(formatDuration(-5, 'tr')).toBe('0 dk');
  });

  it('rounds audio length for "Dinle · {minutes} dk"', () => {
    expect(audioMinutes(130)).toBe(2);
    expect(audioMinutes(20)).toBe(1);
  });
});
