import { describe, expect, it } from 'vitest';
import {
  type AmountMatch,
  decimalStringToMinor,
  formatMoney,
  minorToDecimalString,
  parseAmountsTR,
  parseNumberTR,
  resolveAmountTR,
} from '../../src/extract/amount-tr.ts';

type Row = [
  text: string,
  minor: number,
  currency: AmountMatch['currency'],
  confidence: AmountMatch['confidence'],
  refund?: boolean,
];

// AI_PIPELINE_PLAN §6.9.3 + TEST_PLAN UT-AMT-01..07: every value is an integer in minor units.
const CASES: Row[] = [
  ['1.842 TL', 184200, 'TRY', 'high'],
  ['₺1.842,50', 184250, 'TRY', 'high'],
  ['1.842,50 TRY', 184250, 'TRY', 'high'],
  ['229,99 TL / ay', 22999, 'TRY', 'high'],
  ['12,5 bin TL', 1250000, 'TRY', 'high'],
  ['2 milyon lira', 200000000, 'TRY', 'high'],
  ['2 milyon TL', 200000000, 'TRY', 'high'],
  ['1,5 milyar TL', 150000000000, 'TRY', 'high'],
  ['50 kuruş', 50, 'TRY', 'high'],
  ['50 kurus', 50, 'TRY', 'high'],
  ['10 TL 50 kuruş', 1050, 'TRY', 'high'],
  ['₺1,842.50', 184250, 'TRY', 'medium'],
  ['1842.50 TL', 184250, 'TRY', 'medium'],
  ['-1.250 TL iade', -125000, 'TRY', 'high', true],
  ['-120,00 TL iade', -12000, 'TRY', 'high', true],
  ['İade tutarı 349,90 TL', -34990, 'TRY', 'high', true],
  ['$1,842.50', 184250, 'USD', 'high'],
  ['$49.99', 4999, 'USD', 'high'],
  ['€1.234,56', 123456, 'EUR', 'high'],
  ['£12', 1200, 'GBP', 'high'],
  ['49,90 €', 4990, 'EUR', 'high'],
  ['100 USD', 10000, 'USD', 'high'],
  ['250 dolar', 25000, 'USD', 'high'],
  ['75 euro', 7500, 'EUR', 'high'],
  ['TL 1.842', 184200, 'TRY', 'high'],
  ['TRY 99', 9900, 'TRY', 'high'],
  ['₺ 750', 75000, 'TRY', 'high'],
  ['1.842.000 TL', 184200000, 'TRY', 'high'],
  ['0,99 TL', 99, 'TRY', 'high'],
  ['5 TL', 500, 'TRY', 'high'],
  ['18 lira', 1800, 'TRY', 'high'],
  ['349 Türk Lirası', 34900, 'TRY', 'high'],
  ['1.250 TL’dir', 125000, 'TRY', 'high'],
  ['Toplam: 3.499,00 TL', 349900, 'TRY', 'high'],
  ['Faturanız 1.842,17 TL', 184217, 'TRY', 'high'],
  ['Aidat 850TL', 85000, 'TRY', 'high'],
  ['Ödenecek tutar ₺12.500', 1250000, 'TRY', 'high'],
];

describe('parseAmountsTR — fixtures', () => {
  it.each(CASES)('%s → %d %s', (text, minor, currency, confidence, refund = false) => {
    const all = parseAmountsTR(text);
    expect(all, JSON.stringify(all)).toHaveLength(1);
    const a = all[0];
    expect(a?.minor).toBe(minor);
    expect(Number.isInteger(a?.minor)).toBe(true);
    expect(a?.currency).toBe(currency);
    expect(a?.confidence).toBe(confidence);
    expect(a?.refund).toBe(refund);
  });

  it.each([
    '1.842',
    'TK2412',
    'TL2412',
    'Sipariş no 12345678901',
    'Fiyat bilgisi yok',
    '3 kişi',
    '2026 yılı',
    '',
  ])('"%s" has no amount (UT-AMT-08)', (text) => {
    expect(parseAmountsTR(text)).toEqual([]);
  });

  it('keeps the original span', () => {
    const text = 'Elektrik faturası ₺1.842,50 olarak kesildi.';
    const [a] = parseAmountsTR(text);
    expect(a?.text).toBe('₺1.842,50');
  });

  it('a dash separator is not a minus sign', () => {
    const [a] = parseAmountsTR('Fiyat - 1.250 TL');
    expect(a?.minor).toBe(125000);
    expect(a?.refund).toBe(false);
  });

  it('finds several amounts in order', () => {
    expect(parseAmountsTR('Ana para 1.842 TL, faiz 300 TL').map((a) => a.minor)).toEqual([
      184200, 30000,
    ]);
  });
});

describe('resolveAmountTR', () => {
  it('two different amounts are ambiguous (UT-AMT-09)', () => {
    expect(resolveAmountTR('1.842 TL ve 300 TL').status).toBe('ambiguous');
  });
  it('the same amount twice is one value', () => {
    const r = resolveAmountTR('1.842 TL (₺1.842)');
    expect(r.status).toBe('one');
  });
  it('no amount', () => {
    expect(resolveAmountTR('ödeme yapıldı').status).toBe('none');
  });
});

describe('number and money helpers', () => {
  it.each([
    ['1.842', '1842', '', 'high'],
    ['1.842,50', '1842', '50', 'high'],
    ['1,842.50', '1842', '50', 'medium'],
    ['1842.50', '1842', '50', 'medium'],
    ['12,5', '12', '5', 'high'],
    ['1,842', '1842', '', 'medium'],
  ])('parseNumberTR(%s)', (raw, int, frac, conf) => {
    expect(parseNumberTR(raw)).toEqual({ intDigits: int, fracDigits: frac, confidence: conf });
  });

  it('rejects malformed numbers', () => {
    expect(parseNumberTR('1.84.2')).toBeNull();
    expect(parseNumberTR('1,2,3')).toBeNull();
    expect(parseNumberTR('abc')).toBeNull();
  });

  it('formats money in tr-TR (UT-AMT-10)', () => {
    expect(formatMoney(184200, 'TRY')).toBe('₺1.842,00');
  });

  it.each([
    [184250, '1842.50'],
    [5, '0.05'],
    [-12000, '-120.00'],
    [0, '0.00'],
  ])('minorToDecimalString(%d) = %s and back', (minor, s) => {
    expect(minorToDecimalString(minor)).toBe(s);
    expect(decimalStringToMinor(s)).toBe(minor);
  });

  it('rejects non-integer minor units and bad decimals', () => {
    expect(() => minorToDecimalString(1.5)).toThrow(RangeError);
    expect(() => decimalStringToMinor('1,5')).toThrow(RangeError);
  });
});
