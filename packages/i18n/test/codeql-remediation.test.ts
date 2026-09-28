/**
 * CodeQL js/polynomial-redos in `tr-suffix.ts` (security-nightly, TST-CI-08): the "…at the end"
 * regexes became linear scans. Each attack shape runs at 50 000 repetitions within a generous
 * budget, and the scans are compared with the original regexes over seeded random input.
 */
import { describe, expect, it, vi } from 'vitest';

import { numberAtEnd, withoutTrailingNonWord, wordAtEnd } from '../src/text-end.ts';
import { trCaseSuffix, trSuffix } from '../src/tr-suffix.ts';

const N = 50_000;

/**
 * Growth-rate check rather than a wall-clock budget (a fixed 200 ms budget failed on a loaded CI
 * runner): `fn(n)` runs at N / 4 and at N, best of ROUNDS each, the two sizes taking turns so a
 * load spike slows both rather than only one. A linear scan grows about 4×; the quadratic
 * originals grow about 16× and took seconds at N. A run under FLOOR_MS passes outright.
 */
/** Each growth check runs its input 2 × ROUNDS times, over vitest's 5 s default on a CI runner. */
vi.setConfig({ testTimeout: 30_000 });

const FLOOR_MS = 100;
const MAX_GROWTH = 8;
const ROUNDS = 3;

/**
 * Thread CPU time rather than wall-clock: on a busy runner a long run is preempted far more often
 * than a short one, which inflated the ratio of a linear scan past MAX_GROWTH.
 */
function timedRun<T>(fn: () => T): { value: T; ms: number } {
  const start = process.threadCpuUsage();
  const value = fn();
  const used = process.threadCpuUsage(start);
  return { value, ms: (used.user + used.system) / 1000 };
}

function linear<T>(fn: (n: number) => T): T {
  let small = timedRun(() => fn(N / 4)).ms;
  let large = timedRun(() => fn(N));
  for (let i = 1; i < ROUNDS; i++) {
    small = Math.min(small, timedRun(() => fn(N / 4)).ms);
    const next = timedRun(() => fn(N));
    if (next.ms < large.ms) large = next;
  }
  const ok = large.ms < FLOOR_MS || large.ms < MAX_GROWTH * Math.max(small, 1);
  expect(ok ? 'linear' : `${large.ms.toFixed(1)} ms at N vs ${small.toFixed(1)} ms at N / 4`).toBe(
    'linear',
  );
  return large.value;
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
    expect(linear((N) => numberAtEnd(`${'0'.repeat(N)}a`))).toBeNull();
    expect(linear((N) => numberAtEnd(`x ${'0'.repeat(N)}`))).toBe('0'.repeat(N));
    expect(linear((N) => withoutTrailingNonWord(`${'!'.repeat(N)}a`))).toBe(`${'!'.repeat(N)}a`);
    expect(linear((N) => withoutTrailingNonWord(`a${'!'.repeat(N)}`))).toBe('a');
    expect(linear((N) => wordAtEnd(`${'a'.repeat(N)}!b`))).toBe('b');
  });

  it('suffixes long values quickly and still reads the last number or word', () => {
    expect(linear((N) => trSuffix(`${'0'.repeat(N)}a`, 'dative'))).toBe(`${'0'.repeat(N)}a'ya`);
    expect(linear((N) => trCaseSuffix(`${'!'.repeat(N)}6`, 'dative'))).toBe('ya');
    expect(linear((N) => trCaseSuffix(`${'a'.repeat(N)}!Ahmet`, 'locative'))).toBe('te');
    expect(
      linear((N) => trSuffix(`${'kitap '.repeat(N / 10)}kitap`, 'dative', { apostrophe: false })),
    ).toMatch(/kitaba$/);
  });
});
