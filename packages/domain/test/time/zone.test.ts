import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateWithWeekday,
  formatRelativeDistance,
  formatShortDate,
  formatTime,
} from '../../src/time/format.ts';
import {
  addDaysToLocalDate,
  addMinutes,
  atLocalTime,
  diffMinutes,
  endOfLocalDay,
  endOfMonthLocalDate,
  epochSeconds,
  hhmmFromMinutes,
  isLocalDateString,
  isoWeekdayOf,
  isoWeekStart,
  isValidTimeZone,
  isWithinQuietHours,
  localDate,
  localDateDiffDays,
  localParts,
  localTime,
  minutesOfDay,
  nextQuietWindow,
  parseHHmm,
  quietWindowContaining,
  startOfLocalDay,
  toDate,
  toIso,
  tzOffsetMinutes,
} from '../../src/time/zone.ts';

const IST = 'Europe/Istanbul';
const BER = 'Europe/Berlin';
const NY = 'America/New_York';

describe('local dates and times', () => {
  it('UT-TZ-01: 21:30Z is the next local day in Istanbul', () => {
    expect(localDate('2026-09-23T21:30:00Z', IST)).toBe('2026-09-24');
    expect(localTime('2026-09-23T21:30:00Z', IST)).toBe('00:30');
  });

  it('local parts include ISO weekday and offset', () => {
    expect(localParts('2026-09-23T06:00:00Z', IST)).toMatchObject({
      year: 2026,
      month: 9,
      day: 23,
      hour: 9,
      isoWeekday: 3,
      offsetMinutes: 180,
    });
    expect(localParts('2026-09-27T10:00:00Z', IST).isoWeekday).toBe(7);
  });

  it('accepts Date, ISO strings and epoch numbers; rejects invalid input', () => {
    const ms = Date.UTC(2026, 8, 23, 6);
    expect(toIso(ms)).toBe('2026-09-23T06:00:00.000Z');
    expect(toIso(new Date(ms))).toBe(toIso('2026-09-23T06:00:00Z'));
    expect(() => toDate('not a date')).toThrow(RangeError);
    expect(() => localDate('2026-09-23T06:00:00Z', 'Mars/Olympus')).toThrow(RangeError);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('atLocalTime — DST-safe (UT-TZ-02..07)', () => {
  it.each([
    ['2026-10-24', '08:00', BER, '2026-10-24T06:00:00.000Z'],
    ['2026-10-25', '08:00', BER, '2026-10-25T07:00:00.000Z'],
    ['2026-03-28', '08:00', BER, '2026-03-28T07:00:00.000Z'],
    ['2026-03-29', '08:00', BER, '2026-03-29T06:00:00.000Z'],
    ['2026-03-29', '02:30', BER, '2026-03-29T01:30:00.000Z'], // gap → forward
    ['2026-10-25', '02:30', BER, '2026-10-25T00:30:00.000Z'], // overlap → earliest
    ['2026-03-08', '02:30', NY, '2026-03-08T07:30:00.000Z'],
    ['2026-11-01', '01:30', NY, '2026-11-01T05:30:00.000Z'],
    ['2026-10-25', '08:00', IST, '2026-10-25T05:00:00.000Z'],
    ['2015-12-01', '08:00', IST, '2015-12-01T06:00:00.000Z'],
    ['2026-09-27', '18:00', IST, '2026-09-27T15:00:00.000Z'],
    ['2026-09-27', '18:00', BER, '2026-09-27T16:00:00.000Z'],
  ])('%s %s %s → %s', (date, time, tz, iso) => {
    expect(atLocalTime(date, time, tz).toISOString()).toBe(iso);
  });

  it('uses the local date of an instant', () => {
    expect(atLocalTime('2026-09-23T21:30:00Z', '08:00', IST).toISOString()).toBe(
      '2026-09-24T05:00:00.000Z',
    );
  });

  it('day boundaries follow DST (25-hour day)', () => {
    const start = startOfLocalDay('2026-10-25', BER);
    const end = endOfLocalDay('2026-10-25', BER);
    expect(diffMinutes(start, end)).toBe(25 * 60);
  });

  it('tz offsets', () => {
    expect(tzOffsetMinutes(BER, '2026-10-25T00:30:00Z')).toBe(120);
    expect(tzOffsetMinutes(BER, '2026-10-25T01:30:00Z')).toBe(60);
  });
});

describe('isWithinQuietHours (R-13, UT-TZ-08)', () => {
  it.each([
    ['2026-10-24T20:29:00Z', false],
    ['2026-10-24T20:30:00Z', true],
    ['2026-10-25T03:00:00Z', true],
    ['2026-10-25T06:29:00Z', true],
    ['2026-10-25T06:30:00Z', false],
    ['2026-10-25T12:00:00Z', false],
  ])('default 22:30–07:30 in Berlin across the fall-back night: %s → %s', (now, quiet) => {
    expect(isWithinQuietHours('22:30', '07:30', now, BER)).toBe(quiet);
  });

  it('the fall-back quiet window lasts 10 h in UTC', () => {
    const w = quietWindowContaining({ start: '22:30', end: '07:30' }, '2026-10-25T01:00:00Z', BER);
    expect(w?.start.toISOString()).toBe('2026-10-24T20:30:00.000Z');
    expect(w?.end.toISOString()).toBe('2026-10-25T06:30:00.000Z');
    expect(w?.startLocalDate).toBe('2026-10-24');
  });

  it('a same-day window (13:00–14:00) and an empty window', () => {
    expect(isWithinQuietHours('13:00', '14:00', '2026-09-23T10:30:00Z', IST)).toBe(true);
    expect(isWithinQuietHours('13:00', '14:00', '2026-09-23T11:00:00Z', IST)).toBe(false);
    expect(isWithinQuietHours('22:00', '22:00', '2026-09-23T19:30:00Z', IST)).toBe(false);
  });

  it('quiet days restrict the start day of the window', () => {
    // window starting Saturday night only
    expect(isWithinQuietHours('22:30', '07:30', '2026-09-26T21:00:00Z', IST, [6])).toBe(true);
    expect(isWithinQuietHours('22:30', '07:30', '2026-09-25T21:00:00Z', IST, [6])).toBe(false);
    // Sunday 01:00 belongs to Saturday's window
    expect(isWithinQuietHours('22:30', '07:30', '2026-09-26T22:00:00Z', IST, [6])).toBe(true);
  });

  it('next quiet window', () => {
    const w = nextQuietWindow({ start: '22:30', end: '07:30' }, '2026-09-23T06:00:00Z', IST);
    expect(w?.start.toISOString()).toBe('2026-09-23T19:30:00.000Z');
    expect(
      nextQuietWindow({ start: '10:00', end: '10:00' }, '2026-09-23T06:00:00Z', IST),
    ).toBeNull();
  });
});

describe('calendar arithmetic', () => {
  it('local date helpers', () => {
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(localDateDiffDays('2026-09-23', '2026-10-03')).toBe(10);
    expect(isoWeekdayOf('2026-09-23')).toBe(3);
    expect(isoWeekStart('2026-09-27')).toBe('2026-09-21');
    expect(endOfMonthLocalDate('2028-02-10')).toBe('2028-02-29');
    expect(isLocalDateString('2026-02-30')).toBe(false);
    expect(isLocalDateString('2026-02-28')).toBe(true);
  });

  it('HH:mm helpers', () => {
    expect(parseHHmm('07:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseHHmm('22:30:00')).toEqual({ hour: 22, minute: 30 });
    expect(() => parseHHmm('24:00')).toThrow(RangeError);
    expect(minutesOfDay('22:30')).toBe(1350);
    expect(hhmmFromMinutes(1350)).toBe('22:30');
    expect(hhmmFromMinutes(-30)).toBe('23:30');
  });

  it('minute arithmetic and epoch seconds', () => {
    expect(addMinutes('2026-09-23T06:00:00Z', 90).toISOString()).toBe('2026-09-23T07:30:00.000Z');
    expect(epochSeconds('1970-01-01T00:01:00Z')).toBe(60);
  });
});

describe('formatting (ADR-14, UT-TZ-09/10)', () => {
  it('24-hour clock in every locale', () => {
    expect(formatTime('2026-09-23T05:00:00Z', IST)).toBe('08:00');
    expect(formatTime('2026-09-23T16:00:00Z', IST)).toBe('19:00');
  });

  it('dates with Turkish and English month names', () => {
    expect(formatDate('2026-09-23T06:00:00Z', IST)).toBe('23 Eylül 2026');
    expect(formatDate('2026-09-23T06:00:00Z', IST, 'en')).toBe('23 September 2026');
    expect(formatShortDate('2026-09-23T06:00:00Z', IST)).toBe('23 Eyl');
    expect(formatDateWithWeekday('2026-09-25T06:00:00Z', IST)).toBe('25 Eylül Cuma');
  });

  it('relative distances use date-fns tr', () => {
    expect(formatRelativeDistance('2026-09-20T06:00:00Z', '2026-09-23T06:00:00Z')).toBe(
      '3 gün önce',
    );
  });
});
