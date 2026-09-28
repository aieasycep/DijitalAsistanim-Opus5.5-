/**
 * CodeQL js/polynomial-redos in `tr-suffix.ts` (security-nightly, TST-CI-08): the "…at the end"
 * regexes became linear scans. Each attack shape runs at 50 000 repetitions within a generous
 * budget, and the scans are compared with the original regexes over seeded random input.
 */
import { describe, expect, it } from 'vitest';

import { numberAtEnd, withoutTrailingNonWord, wordAtEnd } from '../src/text-end.ts';
import { trCaseSuffix, trSuffix } from '../src/tr-suffix.ts';

const N = 50_000;
/** Generous: the scans take a few ms; the original regexes took 3–4 s at this size. */
const BUDGET_MS = 200;

function fast<T>(fn: () => T): T {
  const start = performance.now();
  const value = fn();
  expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  return value;
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samples(seed: number, tokens: readonly string[], count = 4000): string[] {
  const next = prng(seed);
  return Array.from({ length: count }, () => {
    let s = '';
    const len = Math.floor(next() * 12);
    for (let k = 0; k < len; k += 1) s += tokens[Math.floor(next() * tokens.length)] ?? '';
    return s;
  });
}

const TOKENS = [
  '0',
  '7',
  '.',
  ',',
  'a',
  'Ş',
  'ı',
  ' ',
  '!',
  "'",
  '😀',
  '\uD83D',
  '\uDE00',
  '١',
  'é',
];

describe('CodeQL js/polynomial-redos: tr-suffix.ts:304 (numbers, words at the end)', () => {
  it('matches /\\d[\\d.,]*$/ on random input', () => {
    for (const s of samples(21, TOKENS))
      expect(numberAtEnd(s)).toBe(/\d[\d.,]*$/.exec(s)?.[0] ?? null);
  });

  it('matches /[\\p{L}\\p{N}]+$/u on random input', () => {
    for (const s of samples(22, TOKENS)) {
      expect(wordAtEnd(s)).toBe(/[\p{L}\p{N}]+$/u.exec(s)?.[0] ?? null);
    }
  });

  it("matches replace(/[^\\p{L}\\p{N}]+$/u, '') on random input", () => {
    for (const s of samples(23, TOKENS)) {
      expect(withoutTrailingNonWord(s)).toBe(s.replace(/[^\p{L}\p{N}]+$/u, ''));
    }
  });

  it('50 000 × "0" before a letter, "!" before a word and letters before "!" stay linear', () => {
    expect(fast(() => numberAtEnd(`${'0'.repeat(N)}a`))).toBeNull();
    expect(fast(() => numberAtEnd(`x ${'0'.repeat(N)}`))).toBe('0'.repeat(N));
    expect(fast(() => withoutTrailingNonWord(`${'!'.repeat(N)}a`))).toBe(`${'!'.repeat(N)}a`);
    expect(fast(() => withoutTrailingNonWord(`a${'!'.repeat(N)}`))).toBe('a');
    expect(fast(() => wordAtEnd(`${'a'.repeat(N)}!b`))).toBe('b');
  });

  it('suffixes long values quickly and still reads the last number or word', () => {
    expect(fast(() => trSuffix(`${'0'.repeat(N)}a`, 'dative'))).toBe(`${'0'.repeat(N)}a'ya`);
    expect(fast(() => trCaseSuffix(`${'!'.repeat(N)}6`, 'dative'))).toBe('ya');
    expect(fast(() => trCaseSuffix(`${'a'.repeat(N)}!Ahmet`, 'locative'))).toBe('te');
    expect(
      fast(() => trSuffix(`${'kitap '.repeat(N / 10)}kitap`, 'dative', { apostrophe: false })),
    ).toMatch(/kitaba$/);
  });
});
