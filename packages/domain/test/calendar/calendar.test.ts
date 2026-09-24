import { describe, expect, it } from 'vitest';
import {
  analyzeCalendar,
  detectBackToBack,
  detectConflicts,
  findPrepSlot,
  type IntelEvent,
  isMeeting,
  placeInfo,
  prepNeed,
} from '../../src/calendar/intel.ts';
import { findFreeSlots, firstFreeSlot } from '../../src/calendar/slots.ts';

const IST = 'Europe/Istanbul';
const BER = 'Europe/Berlin';
const ist = (hhmm: string, day = '2026-09-23'): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)), h - 3, m),
  ).toISOString();
};
const me = { email: 'yunus@firma.com.tr', self: true };
const ev = (id: string, from: string, to: string, extra: Partial<IntelEvent> = {}): IntelEvent => ({
  id,
  start: ist(from),
  end: ist(to),
  attendees: [me, { email: 'ayse@firma.com.tr' }],
  ...extra,
});

describe('findFreeSlots', () => {
  it('returns every free window inside working hours', () => {
    const slots = findFreeSlots({
      now: ist('08:00'),
      timeZone: IST,
      busy: [{ start: ist('10:00'), end: ist('12:00') }],
      horizonDays: 0,
    });
    expect(slots.map((s) => [s.start.toISOString(), s.minutes])).toEqual([
      [ist('09:00'), 60],
      [ist('12:00'), 360],
    ]);
  });

  it('applies buffers around meetings (focus blocks)', () => {
    const slot = firstFreeSlot({
      now: ist('09:00'),
      timeZone: IST,
      busy: [{ start: ist('09:00'), end: ist('10:00') }],
      bufferMinutes: 10,
      minMinutes: 45,
    });
    expect(slot?.start.toISOString()).toBe(ist('10:10'));
  });

  it('ignores transparent, declined and cancelled events; all-day OOO blocks the day', () => {
    const slot = firstFreeSlot({
      now: ist('09:00'),
      timeZone: IST,
      busy: [
        { start: ist('09:00'), end: ist('18:00'), transparent: true },
        { start: ist('09:00'), end: ist('18:00'), declined: true },
        { start: ist('09:00'), end: ist('18:00'), cancelled: true },
      ],
    });
    expect(slot?.start.toISOString()).toBe(ist('09:00'));
    const ooo = firstFreeSlot({
      now: ist('09:00'),
      timeZone: IST,
      busy: [
        { start: ist('00:00'), end: ist('00:00', '2026-09-24'), allDay: true, outOfOffice: true },
      ],
    });
    expect(ooo?.start.toISOString()).toBe(ist('09:00', '2026-09-24'));
    const birthday = firstFreeSlot({
      now: ist('09:00'),
      timeZone: IST,
      busy: [{ start: ist('00:00'), end: ist('00:00', '2026-09-24'), allDay: true }],
    });
    expect(birthday?.start.toISOString()).toBe(ist('09:00'));
  });

  it('rounds the start up to the 5-minute grid', () => {
    expect(firstFreeSlot({ now: ist('09:02'), timeZone: IST, busy: [] })?.start.toISOString()).toBe(
      ist('09:05'),
    );
  });

  it('a quiet window inside working hours is excluded', () => {
    const slots = findFreeSlots({
      now: ist('09:00'),
      timeZone: IST,
      busy: [],
      horizonDays: 0,
      quietHours: { enabled: true, start: '13:00', end: '14:00' },
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([ist('09:00'), ist('14:00')]);
  });

  it('DST: working hours follow the local clock in Berlin', () => {
    const slot = firstFreeSlot({ now: '2026-10-25T20:00:00Z', timeZone: BER, busy: [] });
    // Monday 26 Oct 09:00 CET = 08:00Z
    expect(slot?.start.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });
});

describe('conflicts (M§20)', () => {
  it('detects overlaps with a stable suppression key and movable events', () => {
    const [c] = detectConflicts([
      ev('b', '14:00', '15:00'),
      ev('a', '14:30', '16:30', { canModify: true }),
    ]);
    expect(c).toMatchObject({ a: 'b', b: 'a', overlapMinutes: 30, movable: ['a'] });
    expect(c?.suppressionKey).toBe(
      `a:b:${Date.parse(ist('14:30')) / 1000}:${Date.parse(ist('14:00')) / 1000}`,
    );
  });

  it('touching events, cancelled, transparent, declined and all-day never conflict', () => {
    expect(detectConflicts([ev('a', '09:00', '10:00'), ev('b', '10:00', '11:00')])).toEqual([]);
    expect(
      detectConflicts([
        ev('a', '09:00', '10:00'),
        ev('b', '09:30', '10:30', { status: 'cancelled' }),
      ]),
    ).toEqual([]);
    expect(
      detectConflicts([
        ev('a', '09:00', '10:00'),
        ev('b', '09:30', '10:30', { transparent: true }),
      ]),
    ).toEqual([]);
    expect(
      detectConflicts([
        ev('a', '09:00', '10:00'),
        ev('b', '09:30', '10:30', { attendees: [{ ...me, response: 'declined' }] }),
      ]),
    ).toEqual([]);
    expect(
      detectConflicts([ev('a', '09:00', '10:00'), ev('b', '00:00', '23:59', { allDay: true })]),
    ).toEqual([]);
  });

  it('finds all overlapping pairs', () => {
    const cs = detectConflicts([
      ev('a', '09:00', '12:00'),
      ev('b', '10:00', '11:00'),
      ev('c', '10:30', '11:30'),
    ]);
    expect(cs.map((c) => `${c.a}-${c.b}`)).toEqual(['a-b', 'a-c', 'b-c']);
  });
});

describe('back-to-back (gap < 10 min)', () => {
  it('groups consecutive meetings on the same day', () => {
    const runs = detectBackToBack(
      [
        ev('a', '09:00', '10:00'),
        ev('b', '10:05', '11:00'),
        ev('c', '11:00', '12:00'),
        ev('d', '12:30', '13:00'),
      ],
      IST,
    );
    expect(runs).toEqual([
      { localDate: '2026-09-23', eventIds: ['a', 'b', 'c'], minGapMinutes: 0 },
    ]);
  });

  it('a 10-minute gap is not back-to-back; solo events are not meetings', () => {
    expect(detectBackToBack([ev('a', '09:00', '10:00'), ev('b', '10:10', '11:00')], IST)).toEqual(
      [],
    );
    const solo = { attendees: [me] };
    expect(
      detectBackToBack([ev('a', '09:00', '10:00', solo), ev('b', '10:00', '11:00', solo)], IST),
    ).toEqual([]);
    expect(isMeeting(ev('x', '09:00', '10:00', { attendees: [me], isOnline: true }))).toBe(true);
  });
});

describe('prep need (external / VIP attendees, R-23)', () => {
  const ctx = {
    timeZone: IST,
    ownDomains: ['firma.com.tr'],
    vipContactIds: ['c-mehmet'],
    isPro: true,
  };

  it('internal meetings need no prep', () => {
    expect(prepNeed(ev('a', '14:30', '15:30'), ctx)).toEqual({
      needed: false,
      reasons: [],
      externalAttendees: 0,
    });
  });

  it('external attendees', () => {
    const e = ev('a', '14:30', '15:30', {
      attendees: [me, { email: 'mehmet@yilmazendustri.com.tr' }],
    });
    expect(prepNeed(e, ctx)).toMatchObject({
      needed: true,
      reasons: ['external_attendees'],
      externalAttendees: 1,
    });
  });

  it('VIP attendee (Pro only); declined attendees do not count', () => {
    const e = ev('a', '14:30', '15:30', {
      attendees: [me, { email: 'x@firma.com.tr', contactId: 'c-mehmet' }],
    });
    expect(prepNeed(e, ctx).reasons).toEqual(['vip_attendee']);
    expect(prepNeed(e, { ...ctx, isPro: false }).needed).toBe(false);
    const declined = ev('a', '14:30', '15:30', {
      attendees: [me, { email: 'm@dis.com', response: 'declined' }],
    });
    expect(prepNeed(declined, ctx).needed).toBe(false);
  });

  it('prep slot: ≥30 min free within 3 h before the meeting', () => {
    const e = ev('m', '14:30', '15:30', {
      attendees: [me, { email: 'mehmet@yilmazendustri.com.tr' }],
    });
    const slot = findPrepSlot(e, [{ start: ist('11:30'), end: ist('13:00') }], {
      ...ctx,
      now: ist('09:00'),
    });
    expect(slot?.start.toISOString()).toBe(ist('13:00'));
    expect(findPrepSlot(ev('i', '14:30', '15:30'), [], { ...ctx, now: ist('09:00') })).toBeNull();
  });

  it('analyzeCalendar bundles all signals', () => {
    const r = analyzeCalendar(
      [
        ev('a', '09:00', '10:00'),
        ev('b', '09:30', '10:05'),
        ev('c', '10:05', '11:00', { attendees: [me, { email: 'dis@musteri.com' }] }),
      ],
      ctx,
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.backToBack[0]?.eventIds).toEqual(['a', 'b', 'c']);
    expect(r.prep).toEqual([{ eventId: 'c', reasons: ['external_attendees'] }]);
  });
});

describe('place info: location only if present, never invented travel time', () => {
  it('passes through the stated location and a verified leave-by only', () => {
    expect(placeInfo(ev('a', '09:00', '10:00', { location: '  Kuzey Lojistik Ofis ' }))).toEqual({
      location: 'Kuzey Lojistik Ofis',
      isOnline: false,
      leaveBy: null,
    });
    expect(placeInfo(ev('a', '09:00', '10:00', { location: '' })).location).toBeNull();
    expect(placeInfo(ev('a', '09:00', '10:00'), ist('08:15')).leaveBy?.toISOString()).toBe(
      ist('08:15'),
    );
  });
});
