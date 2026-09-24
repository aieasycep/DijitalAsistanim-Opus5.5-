import { describe, expect, it } from 'vitest';
import type { BusyInterval } from '../../src/calendar/slots.ts';
import {
  REMINDER_PRESETS,
  resolveAllPresets,
  resolvePreset,
  verifyPresetTime,
} from '../../src/reminders/presets.ts';

const IST = 'Europe/Istanbul';
const BER = 'Europe/Berlin';
/** Istanbul local time on a date → UTC ISO (UTC+3). */
const ist = (hhmm: string, day = '2026-09-23'): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)), h - 3, m),
  ).toISOString();
};
const busy = (from: string, to: string, day = '2026-09-23'): BusyInterval => ({
  start: ist(from, day),
  end: ist(to, day),
});

describe('preset order (M§29, S-04)', () => {
  it('exactly the six presets in master order', () => {
    expect(REMINDER_PRESETS).toEqual([
      'before_30m',
      'before_1h',
      'this_evening',
      'tomorrow_morning',
      'smart',
      'custom',
    ]);
  });
});

describe('UT-REM-01: anchor today 17:00, now 09:00', () => {
  const ctx = {
    now: ist('09:00'),
    timeZone: IST,
    anchorAt: ist('17:00'),
    calendarConnected: true,
    busy: [busy('09:00', '10:00'), busy('11:30', '12:10'), busy('14:30', '15:30')],
  };
  const all = resolveAllPresets(ctx);
  const byPreset = Object.fromEntries(all.map((r) => [r.preset, r]));

  it.each([
    ['before_30m', '16:30', 'today'],
    ['before_1h', '16:00', 'today'],
    ['this_evening', '19:00', 'today'],
    ['tomorrow_morning', '08:00', 'tomorrow'],
    ['smart', '10:00', 'today'],
  ] as const)('%s → %s %s', (preset, time, day) => {
    const r = byPreset[preset];
    expect(r?.valid).toBe(true);
    expect(r?.label).toMatchObject({ time, relativeDay: day });
  });

  it('every valid preset has an absolute time and a reason', () => {
    for (const r of all.filter((x) => x.valid)) {
      expect(r.fireAt).toBeInstanceOf(Date);
      expect(r.reason?.key).toMatch(/^reminder\.reason\./);
    }
    expect(byPreset.before_30m?.reason).toEqual({
      key: 'reminder.reason.before_anchor',
      params: { minutes: 30, anchor_time: '17:00' },
    });
  });

  it('custom needs the picker value', () => {
    expect(byPreset.custom).toMatchObject({ valid: false, invalidReason: 'needs_input' });
  });
});

describe('before_* presets', () => {
  it('UT-REM-02: past resolutions are hidden', () => {
    const r = resolvePreset('before_30m', {
      now: ist('16:45'),
      timeZone: IST,
      anchorAt: ist('17:00'),
    });
    expect(r).toMatchObject({ valid: false, invalidReason: 'in_past', hidden: true });
    expect(
      resolvePreset('before_1h', { now: ist('16:45'), timeZone: IST, anchorAt: ist('17:00') })
        .hidden,
    ).toBe(true);
  });

  it('within one minute counts as past', () => {
    expect(
      resolvePreset('before_30m', { now: ist('16:29'), timeZone: IST, anchorAt: ist('17:00') })
        .invalidReason,
    ).toBe('in_past');
  });

  it('UT-REM-03: date-only anchor hides before_*', () => {
    const r = resolvePreset('before_1h', {
      now: ist('09:00'),
      timeZone: IST,
      anchorAt: ist('00:00', '2026-09-25'),
      anchorDateOnly: true,
    });
    expect(r).toMatchObject({ valid: false, invalidReason: 'no_anchor', hidden: true });
    expect(resolvePreset('before_30m', { now: ist('09:00'), timeZone: IST }).invalidReason).toBe(
      'no_anchor',
    );
  });
});

describe('this_evening / tomorrow_morning', () => {
  it('evening is disabled from evening − 5 min', () => {
    expect(resolvePreset('this_evening', { now: ist('18:54'), timeZone: IST }).valid).toBe(true);
    expect(resolvePreset('this_evening', { now: ist('18:55'), timeZone: IST })).toMatchObject({
      valid: false,
      invalidReason: 'in_past',
      hidden: false,
    });
  });

  it('uses the user evening and morning times', () => {
    const prefs = { eveningTime: '20:30', morningTime: '07:15' };
    expect(
      resolvePreset('this_evening', { now: ist('09:00'), timeZone: IST, prefs }).label?.time,
    ).toBe('20:30');
    expect(
      resolvePreset('tomorrow_morning', { now: ist('09:00'), timeZone: IST, prefs }).label?.time,
    ).toBe('07:15');
  });

  it('UT-REM-04: tomorrow morning across the Berlin fall-back', () => {
    const r = resolvePreset('tomorrow_morning', { now: '2026-10-24T06:00:00Z', timeZone: BER });
    expect(r.fireAt?.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('tomorrow morning across the Berlin spring-forward', () => {
    const r = resolvePreset('tomorrow_morning', { now: '2026-03-28T07:00:00Z', timeZone: BER });
    expect(r.fireAt?.toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });
});

describe('"Uygun zamanda" (smart)', () => {
  const base = { timeZone: IST, calendarConnected: true, anchorAt: ist('17:00') };

  it('UT-REM-05: first free slot after the 11:30–12:10 meeting → 12:10 with a calendar reason', () => {
    const r = resolvePreset('smart', {
      ...base,
      now: ist('11:40'),
      busy: [busy('09:00', '10:00'), busy('11:30', '12:10'), busy('14:30', '15:30')],
    });
    expect(r.label?.time).toBe('12:10');
    expect(r.reason).toEqual({
      key: 'reminder.reason.calendar_slot',
      params: { time: '12:10', day: 'today', date: '2026-09-23' },
    });
  });

  it('UT-REM-06: gaps under 15 min are skipped', () => {
    const r = resolvePreset('smart', {
      ...base,
      now: ist('09:00'),
      busy: [busy('09:00', '10:00'), busy('10:10', '11:00'), busy('11:10', '12:00')],
    });
    expect(r.label?.time).toBe('12:00');
  });

  it('UT-REM-07: before working hours → 09:00', () => {
    expect(resolvePreset('smart', { ...base, now: ist('07:30'), busy: [] }).label?.time).toBe(
      '09:00',
    );
  });

  it('UT-REM-08: no slot before due → invalid, UI offers "Kendin seç"', () => {
    const r = resolvePreset('smart', {
      ...base,
      now: ist('09:00'),
      busy: [busy('09:00', '17:00')],
    });
    expect(r).toMatchObject({ valid: false, invalidReason: 'no_free_slot' });
  });

  it('UT-REM-09: never inside quiet hours, even with edited working hours', () => {
    const r = resolvePreset('smart', {
      timeZone: IST,
      calendarConnected: true,
      now: ist('06:00'),
      busy: [],
      prefs: { workingHours: { start: '06:00', end: '23:00', days: [1, 2, 3, 4, 5, 6, 7] } },
    });
    expect(r.label?.time).toBe('07:30');
    expect(r.inQuietHours).toBe(false);
  });

  it('UT-REM-10: weekend → next working day, provided it is before due', () => {
    const sat = '2026-09-26';
    const r = resolvePreset('smart', {
      timeZone: IST,
      calendarConnected: true,
      now: ist('10:00', sat),
      anchorAt: ist('17:00', '2026-09-28'),
      busy: [],
    });
    expect(r.label).toMatchObject({ localDate: '2026-09-28', time: '09:00' });
    const tooLate = resolvePreset('smart', {
      timeZone: IST,
      calendarConnected: true,
      now: ist('10:00', sat),
      anchorAt: ist('20:00', sat),
      busy: [],
    });
    expect(tooLate.invalidReason).toBe('no_free_slot');
  });

  it('date-only anchor searches until the end of working hours on that day', () => {
    const r = resolvePreset('smart', {
      timeZone: IST,
      calendarConnected: true,
      now: ist('09:00'),
      anchorAt: ist('00:00', '2026-09-25'),
      anchorDateOnly: true,
      busy: [
        busy('09:00', '18:00'),
        busy('09:00', '18:00', '2026-09-24'),
        busy('09:00', '17:30', '2026-09-25'),
      ],
    });
    expect(r.label).toMatchObject({ localDate: '2026-09-25', time: '17:30' });
  });

  it('no calendar connected → disabled', () => {
    expect(
      resolvePreset('smart', { now: ist('09:00'), timeZone: IST, calendarConnected: false })
        .invalidReason,
    ).toBe('no_calendar');
  });

  it('respects the duration hint', () => {
    const r = resolvePreset('smart', {
      ...base,
      now: ist('09:00'),
      durationMinutes: 45,
      busy: [busy('09:30', '10:30')],
    });
    expect(r.label?.time).toBe('10:30');
  });
});

describe('custom and quiet-hour meta', () => {
  it('a user-chosen time in quiet hours is allowed and flagged', () => {
    const r = resolvePreset('custom', { now: ist('09:00'), timeZone: IST, customAt: ist('23:15') });
    expect(r).toMatchObject({ valid: true, inQuietHours: true });
  });

  it('a past custom time is invalid', () => {
    expect(
      resolvePreset('custom', { now: ist('09:00'), timeZone: IST, customAt: ist('08:00') })
        .invalidReason,
    ).toBe('in_past');
  });

  it('quiet flag off when quiet hours are disabled', () => {
    const r = resolvePreset('custom', {
      now: ist('09:00'),
      timeZone: IST,
      customAt: ist('23:15'),
      prefs: { quietHours: { enabled: false, start: '22:30', end: '07:30' } },
    });
    expect(r.inQuietHours).toBe(false);
  });
});

describe('verifyPresetTime (API-REM-02 server re-resolution)', () => {
  const ctx = { now: ist('09:00'), timeZone: IST, anchorAt: ist('17:00') };
  it('accepts ±60 s', () => {
    expect(verifyPresetTime('before_30m', ist('16:30'), ctx)).toEqual({ ok: true });
    expect(verifyPresetTime('before_30m', '2026-09-23T13:30:59Z', ctx)).toEqual({ ok: true });
  });
  it('a different time is a conflict with the resolved time', () => {
    const r = verifyPresetTime('before_30m', ist('16:00'), ctx);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.resolvedFireAt?.toISOString()).toBe(ist('16:30'));
  });
  it('custom checks only that it is in the future', () => {
    expect(verifyPresetTime('custom', ist('23:00'), ctx)).toEqual({ ok: true });
    expect(verifyPresetTime('custom', ist('08:00'), ctx).ok).toBe(false);
  });
});
