import { describe, expect, it } from 'vitest';

import {
  TR_CASE_ARG_PATTERN,
  baseArgumentName,
  readNumberTr,
  trCaseSuffix,
  trNumberSuffix,
  trSuffix,
  trSuffixForms,
  withTrCases,
  type TrCase,
} from '../src/tr-suffix.ts';

type Row = readonly [value: string | number, grammaticalCase: TrCase, expected: string];

function table(rows: readonly Row[]): void {
  it.each(rows)('%s + %s → %s', (value, grammaticalCase, expected) => {
    expect(trSuffix(value, grammaticalCase)).toBe(expected);
  });
}

describe('names (apostrophe, vowel harmony, no softening in writing)', () => {
  table([
    ['Ahmet', 'dative', "Ahmet'e"],
    ['Ahmet', 'accusative', "Ahmet'i"],
    ['Ahmet', 'locative', "Ahmet'te"],
    ['Ahmet', 'ablative', "Ahmet'ten"],
    ['Ahmet', 'genitive', "Ahmet'in"],
    ['Ahmet', 'instrumental', "Ahmet'le"],
    ['Ayşe', 'dative', "Ayşe'ye"],
    ['Ayşe', 'accusative', "Ayşe'yi"],
    ['Ayşe', 'locative', "Ayşe'de"],
    ['Ayşe', 'ablative', "Ayşe'den"],
    ['Ayşe', 'genitive', "Ayşe'nin"],
    ['Ayşe', 'instrumental', "Ayşe'yle"],
    ['Mehmet', 'dative', "Mehmet'e"],
    ['Mehmet Yılmaz', 'dative', "Mehmet Yılmaz'a"],
    ['Selin', 'dative', "Selin'e"],
    ['Selin', 'ablative', "Selin'den"],
    ['Selin Kaya', 'genitive', "Selin Kaya'nın"],
    ['Yunus', 'dative', "Yunus'a"],
    ['Yunus', 'ablative', "Yunus'tan"],
    ['Yunus', 'genitive', "Yunus'un"],
    ['Zeynep', 'dative', "Zeynep'e"],
    ['Zeynep', 'accusative', "Zeynep'i"],
    ['Tarık', 'genitive', "Tarık'ın"],
    ['Tarık', 'locative', "Tarık'ta"],
    ['Ali', 'dative', "Ali'ye"],
    ['Ali', 'genitive', "Ali'nin"],
    ['Umut', 'dative', "Umut'a"],
    ['Umut', 'genitive', "Umut'un"],
    ['Özgür', 'dative', "Özgür'e"],
    ['Özgür', 'genitive', "Özgür'ün"],
    ['Gökçe', 'dative', "Gökçe'ye"],
    ['Burcu', 'accusative', "Burcu'yu"],
    ['Kemal', 'dative', "Kemal'e"],
    ['Kemal', 'accusative', "Kemal'i"],
    ['Hilal', 'ablative', "Hilal'den"],
    ['İstanbul', 'dative', "İstanbul'a"],
    ['İstanbul', 'locative', "İstanbul'da"],
    ['Antalya', 'dative', "Antalya'ya"],
    ['Ankara', 'ablative', "Ankara'dan"],
    ['Kuzey Lojistik', 'dative', "Kuzey Lojistik'e"],
    ['Kuzey Lojistik', 'ablative', "Kuzey Lojistik'ten"],
    ['Yılmaz Endüstri', 'genitive', "Yılmaz Endüstri'nin"],
  ]);
});

describe('brands and acronyms (read aloud)', () => {
  table([
    ['Google', 'dative', "Google'a"],
    ['Google', 'locative', "Google'da"],
    ['Microsoft', 'dative', "Microsoft'a"],
    ['Microsoft', 'locative', "Microsoft'ta"],
    ['Gmail', 'locative', "Gmail'de"],
    ['Outlook', 'locative', "Outlook'ta"],
    ['Outlook', 'dative', "Outlook'a"],
    ['Apple', 'dative', "Apple'a"],
    ['iPhone', 'locative', "iPhone'da"],
    ['Netflix', 'dative', "Netflix'e"],
    ['Netflix', 'ablative', "Netflix'ten"],
    ['Trendyol', 'ablative', "Trendyol'dan"],
    ['Microsoft To Do', 'dative', "Microsoft To Do'ya"],
    ['Google Takvim', 'dative', "Google Takvim'e"],
    ['AI', 'genitive', "AI'ın"],
    ['PDF', 'dative', "PDF'ye"],
    ['PDF', 'ablative', "PDF'den"],
    ['THY', 'dative', "THY'ye"],
    ['TL', 'dative', "TL'ye"],
    ['ABD', 'dative', "ABD'ye"],
    ['NATO', 'dative', "NATO'ya"],
    ['ODTÜ', 'dative', "ODTÜ'ye"],
    ['TK2412', 'dative', "TK2412'ye"],
    ['Teklif v2', 'dative', "Teklif v2'ye"],
  ]);
});

describe('numbers (by the last spoken word)', () => {
  table([
    [0, 'dative', "0'a"],
    [1, 'dative', "1'e"],
    [2, 'dative', "2'ye"],
    [3, 'dative', "3'e"],
    [4, 'dative', "4'e"],
    [5, 'dative', "5'e"],
    [6, 'dative', "6'ya"],
    [7, 'dative', "7'ye"],
    [8, 'dative', "8'e"],
    [9, 'dative', "9'a"],
    [10, 'dative', "10'a"],
    [20, 'dative', "20'ye"],
    [30, 'dative', "30'a"],
    [40, 'dative', "40'a"],
    [50, 'dative', "50'ye"],
    [60, 'dative', "60'a"],
    [70, 'dative', "70'e"],
    [80, 'dative', "80'e"],
    [90, 'dative', "90'a"],
    [100, 'dative', "100'e"],
    [1000, 'dative', "1000'e"],
    [1_000_000, 'dative', "1000000'a"],
    [2026, 'dative', "2026'ya"],
    ['1.842', 'dative', "1.842'ye"],
    ['1.000.000.000', 'dative', "1.000.000.000'a"],
    ['3,5', 'dative', "3,5'e"],
    ['%40', 'dative', "%40'a"],
    [3, 'locative', "3'te"],
    [4, 'locative', "4'te"],
    [5, 'locative', "5'te"],
    [40, 'locative', "40'ta"],
    [60, 'locative', "60'ta"],
    [2, 'locative', "2'de"],
    [6, 'locative', "6'da"],
    [100, 'locative', "100'de"],
    [1000, 'locative', "1000'de"],
    [1, 'ablative', "1'den"],
    [3, 'ablative', "3'ten"],
    [9, 'ablative', "9'dan"],
    [40, 'ablative', "40'tan"],
    [1000, 'ablative', "1000'den"],
    [77, 'accusative', "77'yi"],
    [77, 'genitive', "77'nin"],
    [77, 'possessive', "77'si"],
    [77, 'possessiveAccusative', "77'sini"],
    [3, 'possessiveAccusative', "3'ünü"],
    [3, 'genitive', "3'ün"],
    [4, 'genitive', "4'ün"],
    [6, 'genitive', "6'nın"],
    [9, 'genitive', "9'un"],
  ]);

  it('trNumberSuffix always uses the apostrophe', () => {
    expect(trNumberSuffix(77, 'possessiveAccusative')).toBe("77'sini");
    expect(trNumberSuffix(6, 'dative')).toBe("6'ya");
    expect(trNumberSuffix(10n, 'ablative')).toBe("10'dan");
  });
});

describe('times (minutes, or the hour on the full hour)', () => {
  table([
    ['09:40', 'ablative', "09:40'tan"],
    ['09:40', 'locative', "09:40'ta"],
    ['09:40', 'dative', "09:40'a"],
    ['10:00', 'ablative', "10:00'dan"],
    ['10:00', 'locative', "10:00'da"],
    ['17:00', 'dative', "17:00'ye"],
    ['17:00', 'locative', "17:00'de"],
    ['17:00', 'ablative', "17:00'den"],
    ['14:30', 'locative', "14:30'da"],
    ['16:30', 'dative', "16:30'a"],
    ['08:00', 'locative', "08:00'de"],
    ['13:00', 'locative', "13:00'te"],
    ['19:00', 'locative', "19:00'da"],
    ['18:00', 'dative', "18:00'e"],
    ['20:00', 'dative', "20:00'ye"],
    ['22:30', 'locative', "22:30'da"],
    ['07:30', 'ablative', "07:30'dan"],
    ['12:00', 'locative', "12:00'de"],
    ['00:00', 'locative', "00:00'da"],
    ['09:05', 'locative', "09:05'te"],
    ['09.40', 'ablative', "09.40'tan"],
  ]);
});

describe('common nouns (no apostrophe, consonant softening)', () => {
  it.each([
    ['kitap', 'dative', 'kitaba'],
    ['kitap', 'locative', 'kitapta'],
    ['ağaç', 'accusative', 'ağacı'],
    ['kanat', 'accusative', 'kanadı'],
    ['köpek', 'dative', 'köpeğe'],
    ['renk', 'accusative', 'rengi'],
    ['top', 'accusative', 'topu'],
    ['saç', 'accusative', 'saçı'],
    ['saat', 'accusative', 'saati'],
    ['saat', 'dative', 'saate'],
    ['ev', 'dative', 'eve'],
    ['ev', 'ablative', 'evden'],
    ['okul', 'dative', 'okula'],
    ['masa', 'dative', 'masaya'],
    ['araba', 'ablative', 'arabadan'],
    ['toplantı', 'plural', 'toplantılar'],
    ['mail', 'plural', 'mailler'],
  ] as const)('%s + %s → %s', (word, grammaticalCase, expected) => {
    expect(trSuffix(word, grammaticalCase, { apostrophe: false })).toBe(expected);
  });

  it('respects explicit softening overrides', () => {
    expect(trSuffix('hukuk', 'accusative', { apostrophe: false })).toBe('hukuku');
    expect(trSuffix('top', 'accusative', { apostrophe: false, soften: true })).toBe('tobu');
    expect(trSuffix('kitap', 'dative', { apostrophe: false, soften: false })).toBe('kitapa');
  });
});

describe('options and helpers', () => {
  it('uses a custom reading when spelling misleads harmony', () => {
    expect(trSuffix('Uber', 'dative', { reading: 'ubır' })).toBe("Uber'a");
  });

  it('uses a custom apostrophe character', () => {
    expect(trSuffix('Ahmet', 'dative', { apostropheChar: '’' })).toBe('Ahmet’e');
  });

  it('returns the bare suffix', () => {
    expect(trCaseSuffix('Ayşe', 'dative')).toBe('ye');
    expect(trCaseSuffix('09:40', 'ablative')).toBe('tan');
  });

  it('returns every form of a value', () => {
    expect(trSuffixForms('Ahmet')).toEqual({
      dative: "Ahmet'e",
      accusative: "Ahmet'i",
      locative: "Ahmet'te",
      ablative: "Ahmet'ten",
      genitive: "Ahmet'in",
      instrumental: "Ahmet'le",
      possessive: "Ahmet'i",
      possessiveAccusative: "Ahmet'ini",
      plural: "Ahmet'ler",
    });
  });

  it('withTrCases adds suffixed ICU values and leaves others alone', () => {
    const values = withTrCases({ time: '17:00', name: 'Ayşe', count: 3, flag: true, empty: '' });
    expect(values.time).toBe('17:00');
    expect(values.time_loc).toBe("17:00'de");
    expect(values.time_dat).toBe("17:00'ye");
    expect(values.time_abl).toBe("17:00'den");
    expect(values.name_dat).toBe("Ayşe'ye");
    expect(values.count_poss).toBe("3'ü");
    expect(values).not.toHaveProperty('flag_dat');
    expect(values.empty_dat).toBe('');
    expect(Object.keys(withTrCases({ a: 'Ali', b: 'Veli' }, ['a']))).toEqual(
      expect.not.arrayContaining(['b_dat']),
    );
  });

  it('maps case-variant argument names back to their base', () => {
    expect(TR_CASE_ARG_PATTERN.test('time_loc')).toBe(true);
    expect(TR_CASE_ARG_PATTERN.test('time')).toBe(false);
    expect(baseArgumentName('identityProvider_loc')).toBe('identityProvider');
    expect(baseArgumentName('count_possacc')).toBe('count');
  });
});

describe('readNumberTr', () => {
  it.each([
    [0, 'sıfır'],
    [7, 'yedi'],
    [11, 'on bir'],
    [77, 'yetmiş yedi'],
    [100, 'yüz'],
    [101, 'yüz bir'],
    [300, 'üç yüz'],
    [1000, 'bin'],
    [1842, 'bin sekiz yüz kırk iki'],
    [2026, 'iki bin yirmi altı'],
    [1_000_000, 'bir milyon'],
    [12_345_678, 'on iki milyon üç yüz kırk beş bin altı yüz yetmiş sekiz'],
    [-5, 'eksi beş'],
    [3.5, 'üç virgül beş'],
    [3.05, 'üç virgül sıfır beş'],
  ] as const)('%s → %s', (value, expected) => {
    expect(readNumberTr(value)).toBe(expected);
  });

  it('reads bigints and rejects non-finite values', () => {
    expect(readNumberTr(5_000_000_000n)).toBe('beş milyar');
    expect(() => readNumberTr(Number.NaN)).toThrow(RangeError);
  });
});
