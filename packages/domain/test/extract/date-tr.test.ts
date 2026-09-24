import { describe, expect, it } from 'vitest';
import {
  type DateResolution,
  dueInstant,
  parseDatesTR,
  resolveDateTR,
} from '../../src/extract/date-tr.ts';

const IST = 'Europe/Istanbul';
/** A1: Çarşamba 23 Eylül 2026, 09:00 Istanbul (TEST_PLAN §2.0). */
const A1 = '2026-09-23T06:00:00Z';
/** A2: Cuma 25 Eylül 2026, 10:00 Istanbul. */
const A2 = '2026-09-25T07:00:00Z';

interface Expect {
  date: string;
  time?: string;
  precision?: DateResolution['precision'];
  by?: boolean;
  ambiguous?: boolean;
  past?: boolean;
  end?: string;
  rule?: DateResolution['ruleId'];
  yearInferred?: boolean;
}

function one(text: string, anchor = A1, tz = IST): DateResolution {
  const all = parseDatesTR(text, { anchor, timeZone: tz });
  expect(all, `expressions in "${text}": ${JSON.stringify(all.map((a) => a.text))}`).toHaveLength(
    1,
  );
  const r = all[0];
  if (!r) throw new Error('unreachable');
  return r;
}

function check(text: string, e: Expect, anchor = A1): void {
  const r = one(text, anchor);
  expect(r.localDate, `${text} date`).toBe(e.date);
  expect(r.localTime, `${text} time`).toBe(e.time ?? null);
  expect(r.precision, `${text} precision`).toBe(e.precision ?? (e.time ? 'datetime' : 'day'));
  expect(r.by, `${text} by`).toBe(e.by ?? false);
  expect(r.ambiguous, `${text} ambiguous`).toBe(e.ambiguous ?? false);
  expect(r.past, `${text} past`).toBe(e.past ?? false);
  if (e.end) expect(r.endLocalDate, `${text} end`).toBe(e.end);
  if (e.rule) expect(r.ruleId, `${text} rule`).toBe(e.rule);
  if (e.yearInferred !== undefined)
    expect(r.yearInferred, `${text} yearInferred`).toBe(e.yearInferred);
}

// Every row is one Turkish fixture resolved against A1 (AI_PIPELINE_PLAN §6.9.1 + TEST_PLAN §2.3).
const A1_CASES: [string, Expect][] = [
  // relative days (UT-DATE-01)
  ['bugün', { date: '2026-09-23', rule: 'R_REL_DAY' }],
  ['yarın', { date: '2026-09-24' }],
  ['Yarın', { date: '2026-09-24' }],
  ['YARIN', { date: '2026-09-24' }],
  ['yarin', { date: '2026-09-24' }],
  ['öbür gün', { date: '2026-09-25' }],
  ['ertesi gün', { date: '2026-09-24' }],
  ['dün', { date: '2026-09-22', past: true }],
  ['yarına kadar', { date: '2026-09-24', by: true }],
  ['Yarından itibaren', { date: '2026-09-24' }],
  // weekdays with suffixes (UT-DATE-02/03)
  ['Cuma gönderirim', { date: '2026-09-25', rule: 'R_WEEKDAY' }],
  ['Cuma', { date: '2026-09-25' }],
  ['Cumaya', { date: '2026-09-25' }],
  ["Cuma'ya", { date: '2026-09-25' }],
  ['Cuma’ya', { date: '2026-09-25' }],
  ['cuma günü', { date: '2026-09-25' }],
  ["Cuma'ya kadar", { date: '2026-09-25', by: true }],
  ['Cumaya kadar', { date: '2026-09-25', by: true }],
  ["Cuma'ya dek", { date: '2026-09-25', by: true }],
  ['en geç Cuma', { date: '2026-09-25', by: true }],
  ['Perşembe', { date: '2026-09-24' }],
  ['Perşembe’ye kadar', { date: '2026-09-24', by: true }],
  ['persembe', { date: '2026-09-24' }],
  ['Salı', { date: '2026-09-29' }],
  ['Salıya', { date: '2026-09-29' }],
  ['sali', { date: '2026-09-29' }],
  ['Pazartesi', { date: '2026-09-28' }],
  ['Pazartesiye kadar', { date: '2026-09-28', by: true }],
  ['PAZARTESİ', { date: '2026-09-28' }],
  ['Pazar', { date: '2026-09-27' }],
  ['Pazara', { date: '2026-09-27' }],
  ['Cumartesi', { date: '2026-09-26' }],
  ['Cumartesiye', { date: '2026-09-26' }],
  ['Çarşamba', { date: '2026-09-30', ambiguous: true }],
  ['carsamba', { date: '2026-09-30', ambiguous: true }],
  ['ÇARŞAMBA', { date: '2026-09-30', ambiguous: true }],
  ['gelecek Cuma', { date: '2026-09-25', ambiguous: true, rule: 'R_THIS_WEEKDAY' }],
  // this / next week (UT-DATE-05..08)
  ['bu Cuma', { date: '2026-09-25', rule: 'R_THIS_WEEKDAY' }],
  ['bu Pazartesi', { date: '2026-09-21', ambiguous: true, past: true }],
  ['bu Çarşamba', { date: '2026-09-23' }],
  ['bu Pazar', { date: '2026-09-27' }],
  ['haftaya', { date: '2026-09-30', precision: 'week', ambiguous: true }],
  ['Haftaya dönerim.', { date: '2026-09-30', precision: 'week', ambiguous: true }],
  ['haftaya Salı', { date: '2026-09-29', rule: 'R_NEXT_WEEKDAY' }],
  ['haftaya Cuma', { date: '2026-10-02' }],
  ['haftaya Pazartesi', { date: '2026-09-28' }],
  ['gelecek hafta Çarşamba', { date: '2026-09-30' }],
  ['önümüzdeki haftanın Perşembe günü', { date: '2026-10-01' }],
  ['haftaya bugün', { date: '2026-09-30', rule: 'R_HAFTAYA_BUGUN' }],
  ['gelecek hafta', { date: '2026-09-28', end: '2026-10-04', precision: 'week' }],
  ['önümüzdeki hafta', { date: '2026-09-28', end: '2026-10-04', precision: 'week' }],
  ['onumuzdeki hafta', { date: '2026-09-28', end: '2026-10-04', precision: 'week' }],
  ['haftaya kadar', { date: '2026-10-02', time: '18:00', by: true, ambiguous: true }],
  // weekends and month end (UT-DATE-09/10)
  ['hafta sonu', { date: '2026-09-26', end: '2026-09-27' }],
  ['hafta sonunda', { date: '2026-09-26', end: '2026-09-27' }],
  ['hafta sonuna kadar', { date: '2026-09-25', time: '18:00', by: true, ambiguous: true }],
  ['ay sonu', { date: '2026-09-30' }],
  ['ay sonuna kadar', { date: '2026-09-30', by: true }],
  ['ayın sonuna kadar', { date: '2026-09-30', by: true }],
  // day of month (UT-DATE-11)
  ["ayın 15'i", { date: '2026-10-15', rule: 'R_DOM' }],
  ['ayın 15’i', { date: '2026-10-15' }],
  ["15'ine kadar", { date: '2026-10-15', by: true }],
  ["ayın 30'u", { date: '2026-09-30' }],
  ["ayın 25'ine kadar", { date: '2026-09-25', by: true }],
  // month names and year inference (UT-DATE-12/13)
  ['10 Eylül', { date: '2026-09-10', past: true, yearInferred: true }],
  ['10 Eyl 2026', { date: '2026-09-10', past: true, yearInferred: false }],
  ['10 Eyl. 2026', { date: '2026-09-10', past: true }],
  ['10 EYLÜL', { date: '2026-09-10', past: true }],
  ['10 eylul', { date: '2026-09-10', past: true }],
  ["30 Eylül'de", { date: '2026-09-30' }],
  ['10 Ekim', { date: '2026-10-10' }],
  ['1 Kasım 2026', { date: '2026-11-01' }],
  ['5 Ocak', { date: '2027-01-05', yearInferred: true }],
  ['10 Ocak', { date: '2027-01-10', yearInferred: true }],
  ['3 Şubat', { date: '2027-02-03' }],
  ['3 ŞUBAT', { date: '2027-02-03' }],
  ['3 subat', { date: '2027-02-03' }],
  ['20 Ağustos', { date: '2026-08-20', past: true }],
  ['20 agustos', { date: '2026-08-20', past: true }],
  ['25 Aralık', { date: '2026-12-25' }],
  ['12 Mayıs 2027', { date: '2027-05-12' }],
  ['29 Şubat 2028', { date: '2028-02-29' }],
  // numeric day-first and ISO (UT-DATE-14/18)
  ['15.10.2026', { date: '2026-10-15', rule: 'R_DMY_NUM' }],
  ['15/10', { date: '2026-10-15' }],
  ['12.10.2026', { date: '2026-10-12' }],
  ['12/10', { date: '2026-10-12' }],
  ['2026-10-12', { date: '2026-10-12', rule: 'R_ISO' }],
  ['12-10-26', { date: '2026-10-12' }],
  ['17.10.2026', { date: '2026-10-17' }],
  ['17.09', { date: '2026-09-17', past: true }],
  ['01.11.2026 tarihinde', { date: '2026-11-01' }],
  // relative N (UT-DATE-15)
  ['3 gün içinde', { date: '2026-09-26', by: true }],
  ['2 hafta sonra', { date: '2026-10-07', precision: 'week' }],
  ['iki gün sonra', { date: '2026-09-25' }],
  ['bir hafta içinde', { date: '2026-09-30', precision: 'week', by: true }],
  ['5 gün sonra', { date: '2026-09-28' }],
  ['24 saat içinde', { date: '2026-09-24', time: '09:00', by: true, rule: 'R_REL_HOURS' }],
  // times alone and merged (UT-DATE-16/17)
  ["bugün 17:00'ye kadar", { date: '2026-09-23', time: '17:00', by: true }],
  ['bugün 17.00’ye kadar', { date: '2026-09-23', time: '17:00', by: true }],
  ["17:00'ye kadar", { date: '2026-09-23', time: '17:00', by: true, rule: 'R_TIME_ONLY' }],
  ['saat 17.00', { date: '2026-09-23', time: '17:00' }],
  ["17.00'de", { date: '2026-09-23', time: '17:00' }],
  ["sabah 9'da", { date: '2026-09-23', time: '09:00' }],
  ['öğleden sonra 3', { date: '2026-09-23', time: '15:00' }],
  ["akşam 7'de", { date: '2026-09-23', time: '19:00' }],
  ['gece 11', { date: '2026-09-23', time: '23:00' }],
  ["5'te", { date: '2026-09-23', time: '17:00', ambiguous: true }],
  ["saat 10'da", { date: '2026-09-23', time: '10:00', ambiguous: true }],
  ['akşamüstü', { date: '2026-09-23', time: '17:00', ambiguous: true }],
  ['mesai bitimine kadar', { date: '2026-09-23', time: '18:00', by: true, rule: 'R_EOD' }],
  ['gün sonuna kadar', { date: '2026-09-23', time: '18:00', by: true }],
  ['EOD', { date: '2026-09-23', time: '18:00', by: true }],
  ['yarın öğlen', { date: '2026-09-24', time: '12:00' }],
  ['yarın sabah', { date: '2026-09-24', time: '09:00' }],
  ['yarın akşam', { date: '2026-09-24', time: '19:00' }],
  ['yarın 14:30', { date: '2026-09-24', time: '14:30' }],
  ["yarın saat 10'da", { date: '2026-09-24', time: '10:00', ambiguous: true }],
  ['yarın mesai bitimine kadar', { date: '2026-09-24', time: '18:00', by: true }],
  ['carsamba aksami', { date: '2026-09-30', time: '19:00', ambiguous: true }],
  ['Cuma akşamı', { date: '2026-09-25', time: '19:00' }],
  ['Cuma sabahı', { date: '2026-09-25', time: '09:00' }],
  ['Cuma 14:30', { date: '2026-09-25', time: '14:30' }],
  ['25 Eylül saat 14.00', { date: '2026-09-25', time: '14:00' }],
  ['25 Eylül 14.10', { date: '2026-09-25', time: '14:10' }],
  ['25.09.2026 15:45', { date: '2026-09-25', time: '15:45' }],
  ['son tarih: 25 Eylül', { date: '2026-09-25', by: true }],
  ['Son gün 30 Eylül', { date: '2026-09-30', by: true }],
  ['bugün 08:00', { date: '2026-09-23', time: '08:00', past: true }],
];

describe('parseDatesTR — A1 fixtures', () => {
  it.each(A1_CASES)('%s', (text, e) => {
    check(text, e);
  });
});

describe('parseDatesTR — anchor-sensitive cases', () => {
  it('"Cuma" on a Friday anchor (A2) is next week and ambiguous (UT-DATE-04)', () => {
    check('Cuma', { date: '2026-10-02', ambiguous: true }, A2);
  });
  it('"bugün" follows the anchor, never a hidden clock', () => {
    check('bugün', { date: '2026-09-25' }, A2);
  });
  it('a late-evening UTC anchor uses the Istanbul local date', () => {
    // 21:30Z = 00:30 on the 24th in Istanbul
    check('yarın', { date: '2026-09-25' }, '2026-09-23T21:30:00Z');
  });
});

describe('parseDatesTR — negatives and boundaries (UT-DATE-21)', () => {
  it.each([
    'pazarlık',
    'martı',
    'salıncak',
    'Salim Bey',
    'pazarlıkta anlaştık',
    '1.842 TL',
    'TK2412',
    'Sipariş no 12345678901',
    'Eyleme geçelim',
    '',
  ])('"%s" yields no date', (text) => {
    expect(parseDatesTR(text, { anchor: A1, timeZone: IST })).toEqual([]);
  });

  it('"Cumartesi" never yields "Cuma"', () => {
    const r = one('Cumartesi');
    expect(r.localDate).toBe('2026-09-26');
  });

  it('keeps spans on the original text', () => {
    const text = 'Raporu Cuma’ya kadar gönderirim.';
    const r = one(text);
    expect(r.text).toBe('Cuma’ya kadar');
    expect(text.slice(r.span[0], r.span[1])).toBe('Cuma’ya kadar');
  });

  it('finds several expressions in one sentence in order', () => {
    const all = parseDatesTR('Yarın değil, 30 Eylül Çarşamba 14:00’te görüşelim.', {
      anchor: A1,
      timeZone: IST,
    });
    expect(all.map((a) => a.localDate)).toEqual(['2026-09-24', '2026-09-30', '2026-09-30']);
    expect(all[2]?.localTime).toBe('14:00');
  });

  it('parses a time range', () => {
    const r = one('14:00–18:00 arası');
    expect(r.localTime).toBe('14:00');
    expect(r.endLocalTime).toBe('18:00');
    expect(r.end.toISOString()).toBe('2026-09-23T15:00:00.000Z');
  });

  it('rejects impossible calendar dates', () => {
    expect(parseDatesTR('31.02.2026', { anchor: A1, timeZone: IST })).toEqual([]);
    expect(parseDatesTR('31 Şubat 2026', { anchor: A1, timeZone: IST })).toEqual([]);
  });
});

describe('instants and DST (Europe/Berlin)', () => {
  const B1 = '2026-10-24T06:00:00Z'; // Sat 08:00 CEST, the day before DST ends
  const B2 = '2026-03-28T07:00:00Z'; // Sat 08:00 CET, the day before DST starts
  const BER = 'Europe/Berlin';

  it.each([
    ['yarın 08:00', B1, '2026-10-25T07:00:00.000Z'],
    ['yarın sabah', B1, '2026-10-25T08:00:00.000Z'],
    ['bugün 08:00', B1, '2026-10-24T06:00:00.000Z'],
    ['yarın 02:30', B1, '2026-10-25T00:30:00.000Z'], // overlap → earliest
    ['yarın 08:00', B2, '2026-03-29T06:00:00.000Z'],
    ['bugün 08:00', B2, '2026-03-28T07:00:00.000Z'],
    ['yarın 02:30', B2, '2026-03-29T01:30:00.000Z'], // gap → shifted forward
  ])('%s at %s → %s', (text, anchor, iso) => {
    const r = one(text, anchor, BER);
    expect(r.start.toISOString()).toBe(iso);
  });

  it('day precision covers the whole local day', () => {
    const r = one('yarın', '2026-10-24T06:00:00Z', BER);
    expect(r.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-25T23:00:00.000Z'); // 25-hour day
  });

  it('Istanbul uses the tz database (+02:00 in 2015)', () => {
    const r = one('yarın 08:00', '2015-11-30T10:00:00Z', IST);
    expect(r.start.toISOString()).toBe('2015-12-01T06:00:00.000Z');
  });
});

describe('resolveDateTR and dueInstant', () => {
  it('exactly one value', () => {
    const r = resolveDateTR('Cuma’ya kadar', { anchor: A1, timeZone: IST });
    expect(r.status).toBe('one');
  });
  it('two different dates are ambiguous', () => {
    const r = resolveDateTR('Cuma ya da Pazartesi', { anchor: A1, timeZone: IST });
    expect(r.status).toBe('ambiguous');
  });
  it('no date', () => {
    expect(resolveDateTR('teşekkürler', { anchor: A1, timeZone: IST }).status).toBe('none');
  });
  it('a day-precision deadline is due 18:00 local', () => {
    const r = one('Cuma’ya kadar');
    expect(dueInstant(r, IST).toISOString()).toBe('2026-09-25T15:00:00.000Z');
  });
  it('a week is due Friday 18:00', () => {
    const r = one('gelecek hafta');
    expect(dueInstant(r, IST).toISOString()).toBe('2026-10-02T15:00:00.000Z');
  });
  it('a datetime is due at its time', () => {
    const r = one('bugün 17:00’ye kadar');
    expect(dueInstant(r, IST).toISOString()).toBe('2026-09-23T14:00:00.000Z');
  });
});
