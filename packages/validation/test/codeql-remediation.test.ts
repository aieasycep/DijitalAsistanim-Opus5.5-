/**
 * CodeQL js/polynomial-redos in @da/validation (security-nightly, TST-CI-08): each attack shape
 * runs at 50 000 repetitions within a generous budget and still gives the right answer; each
 * rewritten pattern is compared with the original regex over seeded random input.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanText, draftViolations } from '../src/ai/index.ts';
import { looksLikeContact } from '../src/analytics-events.ts';
import { decodeBase64Utf8 } from '../src/webhooks/index.ts';

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

function samples(seed: number, tokens: readonly string[], count = 3000): string[] {
  const next = prng(seed);
  return Array.from({ length: count }, () => {
    let s = '';
    const len = Math.floor(next() * 14);
    for (let k = 0; k < len; k += 1) s += tokens[Math.floor(next() * tokens.length)] ?? '';
    return s;
  });
}

describe('CodeQL js/polynomial-redos: ai/common.ts:104 cleanText', () => {
  it('50 000 × "<" is cleaned quickly', () => {
    expect(linear((N) => cleanText('<'.repeat(N)))).toBe('<'.repeat(N));
    expect(linear((N) => cleanText(`${'<'.repeat(N)}b>metin`))).toBe('metin');
  });

  it('tags become spaces exactly as replace(/<[^>]*>/g, " ") did', () => {
    const original = (value: string): string =>
      value
        .replace(/<[^>]*>/g, ' ')
        .replace(/(\*\*|__|`+)/g, '')
        .replace(/^\s{0,3}(#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const s of samples(31, ['<', '>', '<b>', 'a', ' ', '\n', '**', '- ', '1. '])) {
      expect(cleanText(s)).toBe(original(s));
    }
    expect(cleanText('**Önemli** <b>teklif</b>\n- madde')).toBe('Önemli teklif madde');
  });
});

describe('CodeQL js/polynomial-redos: ai/reply-drafts.ts:63 e-mail addresses', () => {
  const thread = 'Merhaba, mehmet@yilmaz-endustri.com.tr adresine yazın.';

  it('50 000 × "%" is checked quickly', () => {
    expect(linear((N) => draftViolations('%'.repeat(N), thread))).toEqual([]);
    expect(linear((N) => draftViolations(`${'%'.repeat(N)} x@evil.example.com`, thread))).toEqual([
      'email_not_in_source',
    ]);
  });

  it('finds the addresses the original regex found', () => {
    const original = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const tokens = ['a', 'X', '1', '.', '-', '%', '@', 'b.com', 'co', ' ', '@@', '.x'];
    for (const s of samples(32, tokens)) {
      // `draftViolations` reports an address unless the thread contains it.
      const expected = (s.match(original) ?? []).length > 0;
      expect(draftViolations(s, '').includes('email_not_in_source')).toBe(expected);
      expect(draftViolations(s, s).includes('email_not_in_source')).toBe(false);
    }
  });
});

describe('CodeQL js/polynomial-redos: analytics-events.ts:136 looksLikeContact', () => {
  it('50 000 × "!" is checked quickly', () => {
    expect(linear((N) => looksLikeContact('!'.repeat(N)))).toBe(false);
    expect(linear((N) => looksLikeContact(`${'!'.repeat(N)}@x.co`))).toBe(true);
  });

  it('matches the original /[^\\s@]+@[^\\s@]+\\.[^\\s@]+/ on random input', () => {
    const email = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    const url = /\b(?:https?:\/\/|www\.)|^[a-z][a-z0-9+.-]*:\/\//i;
    for (const s of samples(33, ['a', '@', '.', ' ', '\n', 'b.c', 'x@y', '@@', '.@', '!'])) {
      expect(looksLikeContact(s)).toBe(email.test(s) || url.test(s));
    }
  });
});

describe('CodeQL js/polynomial-redos: webhooks/pubsub.ts:37 base64 padding', () => {
  it('50 000 × "=" is handled quickly', () => {
    expect(linear((N) => decodeBase64Utf8(`${'='.repeat(N)}x`))).toBeNull();
    expect(
      linear((N) => decodeBase64Utf8(`${Buffer.from('ok').toString('base64')}${'='.repeat(N)}`)),
    ).toBe('ok');
  });

  it('strips trailing padding exactly as replace(/=+$/, "") did', () => {
    for (const s of samples(34, ['=', 'QQ', 'b2s', '-', '_', 'x', '=='])) {
      const normalized = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      const valid = /^[A-Za-z0-9+/]*$/.test(normalized) && normalized.length % 4 !== 1;
      if (!valid) expect(decodeBase64Utf8(s)).toBeNull();
      else expect(decodeBase64Utf8(s)).toBe(decodeBase64Utf8(normalized));
    }
  });

  it('returns null, not a RangeError, for UTF-8 sequences past U+10FFFF', () => {
    expect(decodeBase64Utf8(Buffer.from([0xf7, 0xbf, 0xbf, 0xbf]).toString('base64'))).toBeNull();
    expect(decodeBase64Utf8(Buffer.from([0xf4, 0x90, 0x80, 0x80]).toString('base64'))).toBeNull();
    expect(decodeBase64Utf8(Buffer.from('😀').toString('base64'))).toBe('😀');
  });
});
