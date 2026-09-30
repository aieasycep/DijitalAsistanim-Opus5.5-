import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  foldTR,
  matchKeyTR,
  normalizeTR,
  normTR,
  originalSpan,
  tokensTR,
  trLower,
  trUpper,
} from '../../src/extract/normalize-tr.ts';

const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const SHY = String.fromCharCode(0x00ad);
const NBSP = String.fromCharCode(0x00a0);
const NNBSP = String.fromCharCode(0x202f);
const RSQUO = String.fromCharCode(0x2019);
const LDQUO = String.fromCharCode(0x201c);
const RDQUO = String.fromCharCode(0x201d);
const NDASH = String.fromCharCode(0x2013);
const COMBINING_DOT = String.fromCharCode(0x0307);

describe('Turkish case mapping', () => {
  it.each([
    ['İSTANBUL', 'istanbul'],
    ['IRMAK', 'ırmak'],
    ['ŞUBAT', 'şubat'],
    ['PAZARTESİ', 'pazartesi'],
    ['Çarşamba', 'çarşamba'],
  ])('trLower(%s) = %s', (input, out) => {
    expect(trLower(input)).toBe(out);
  });

  it('trUpper maps i → İ and ı → I', () => {
    expect(trUpper('istanbul ırmak')).toBe('İSTANBUL IRMAK');
  });
});

describe('normTR (AI_PIPELINE_PLAN §6.2)', () => {
  it.each([
    [`Bugün 17:00${RSQUO}ye kadar`, "bugün 17:00'ye kadar"],
    [`im${ZWSP}za`, 'imza'],
    [`${BOM}Merhaba`, 'merhaba'],
    [`teklif${SHY}name`, 'teklifname'],
    [`17:00${NBSP}TL`, '17:00 tl'],
    [`a${NNBSP}b`, 'a b'],
    [`${LDQUO}alıntı${RDQUO}`, '"alıntı"'],
    [`09:00${NDASH}10:00`, '09:00-10:00'],
    ['  çok    boşluk \n\t burada  ', 'çok boşluk burada'],
    [`I${COMBINING_DOT}MZA`, 'imza'],
    ['ﬁyat', 'fiyat'],
    ['…', '...'],
  ])('normalises %j', (input, out) => {
    expect(normalizeTR(input)).toBe(out);
  });

  it('keeps a map back to the original string', () => {
    const src = `Son tarih: ${NBSP}25 Eylül${ZWSP}.`;
    const n = normTR(src);
    const from = n.text.indexOf('25 eylül');
    const [s, e] = originalSpan(n, from, from + '25 eylül'.length);
    expect(src.slice(s, e)).toBe(`25 Eylül`);
  });

  it('maps an empty span to a position', () => {
    const n = normTR('abc');
    expect(originalSpan(n, 1, 1)).toEqual([1, 1]);
  });

  it('folds Turkish letters 1:1', () => {
    const s = 'çarşamba öğleden sonra ığdır';
    expect(foldTR(s)).toBe('carsamba ogleden sonra igdir');
    expect(foldTR(s)).toHaveLength(s.length);
  });

  it('matchKeyTR and tokensTR', () => {
    expect(matchKeyTR('  ÇAĞRI  Yılmaz ')).toBe('cagri yilmaz');
    expect(tokensTR('merhaba, 17:00 toplantı!')).toEqual(['merhaba', '17', '00', 'toplantı']);
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});
