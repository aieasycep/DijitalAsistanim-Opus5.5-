/**
 * CodeQL js/polynomial-redos in @da/validation (security-nightly, TST-CI-08): each attack shape
 * runs at 50 000 repetitions within a generous budget and still gives the right answer; each
 * rewritten pattern is compared with the original regex over seeded random input.
 */
import { describe, expect, it } from 'vitest';
import { cleanText, draftViolations } from '../src/ai/index.ts';
import { looksLikeContact } from '../src/analytics-events.ts';
import { decodeBase64Utf8 } from '../src/webhooks/index.ts';

const N = 50_000;
/** Generous: the fixed code takes a few ms; the original regexes took 2–4 s at this size. */
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
    expect(fast(() => cleanText('<'.repeat(N)))).toBe('<'.repeat(N));
    expect(fast(() => cleanText(`${'<'.repeat(N)}b>metin`))).toBe('metin');
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
    expect(fast(() => draftViolations('%'.repeat(N), thread))).toEqual([]);
    expect(fast(() => draftViolations(`${'%'.repeat(N)} x@evil.example.com`, thread))).toEqual([
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
    expect(fast(() => looksLikeContact('!'.repeat(N)))).toBe(false);
    expect(fast(() => looksLikeContact(`${'!'.repeat(N)}@x.co`))).toBe(true);
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
    expect(fast(() => decodeBase64Utf8(`${'='.repeat(N)}x`))).toBeNull();
    expect(
      fast(() => decodeBase64Utf8(`${Buffer.from('ok').toString('base64')}${'='.repeat(N)}`)),
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
