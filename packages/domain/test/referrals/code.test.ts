import { describe, expect, it } from 'vitest';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  generateReferralCode,
  generateUniqueReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  randomIndexFromBytes,
  referralCheckChar,
  referralShareUrl,
  validateReferralCode,
  type RandomIndex,
} from '../../src/referrals/code.ts';

/** Deterministic PRNG (mulberry32) so the tests are reproducible. */
function seeded(seed: number): RandomIndex {
  let state = seed >>> 0;
  return (max) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * max);
  };
}

/** `referral_codes.code` check (DATABASE_AND_RLS_PLAN §4.6) and the API-BIZ-01 body regex. */
const DB_CODE_CHECK = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/;
const API_APPLY_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,10}$/;

describe('UT-REF-11 code alphabet and shape', () => {
  it('uses 31 unambiguous symbols (no 0, O, 1, I, L)', () => {
    expect(REFERRAL_CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTUVWXYZ');
    expect(new Set(REFERRAL_CODE_ALPHABET).size).toBe(31);
    for (const ambiguous of ['0', 'O', '1', 'I', 'L'])
      expect(REFERRAL_CODE_ALPHABET).not.toContain(ambiguous);
  });

  it('generates 7-character codes with a valid check character, accepted by the DB and the API', () => {
    const random = seeded(42);
    for (let i = 0; i < 1000; i++) {
      const code = generateReferralCode(random);
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(code).toMatch(DB_CODE_CHECK);
      expect(code).toMatch(API_APPLY_REGEX);
      expect(isValidReferralCode(code)).toBe(true);
    }
  });

  it('10k generated codes are unique (collisions retried like referral_codes (code) unique)', () => {
    const random = seeded(7);
    const taken = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generateUniqueReferralCode(random, (c) => taken.has(c));
      expect(code).not.toBeNull();
      if (code !== null) taken.add(code);
    }
    expect(taken.size).toBe(10_000);
  });

  it('gives up after maxAttempts collisions', () => {
    expect(generateUniqueReferralCode(seeded(1), () => true, 3)).toBeNull();
  });

  it('rejects a random source that returns out-of-range values', () => {
    expect(() => generateReferralCode(() => 31)).toThrow(RangeError);
    expect(() => generateReferralCode(() => 0.5)).toThrow(RangeError);
  });
});

describe('check character', () => {
  it('matches the documented formula', () => {
    // payload "222222": all values 0 → check "2"; payload "322222": 1·1 = 1 → "3"
    expect(referralCheckChar('222222')).toBe('2');
    expect(referralCheckChar('322222')).toBe('3');
    expect(referralCheckChar('ZZZZZZ')).toBe(REFERRAL_CODE_ALPHABET.charAt((30 * 21) % 31));
  });

  it('detects every single-character substitution and every adjacent payload swap', () => {
    const random = seeded(99);
    for (let n = 0; n < 60; n++) {
      const code = generateReferralCode(random);
      for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        for (const ch of REFERRAL_CODE_ALPHABET) {
          if (ch === code.charAt(i)) continue;
          const typo = code.slice(0, i) + ch + code.slice(i + 1);
          expect(isValidReferralCode(typo), typo).toBe(false);
        }
      }
      for (let i = 0; i < REFERRAL_CODE_LENGTH - 2; i++) {
        if (code.charAt(i) === code.charAt(i + 1)) continue;
        const swapped = code.slice(0, i) + code.charAt(i + 1) + code.charAt(i) + code.slice(i + 2);
        expect(isValidReferralCode(swapped), swapped).toBe(false);
      }
    }
  });
});

describe('input normalisation and validation', () => {
  const valid = generateReferralCode(seeded(5));

  it.each([
    [valid.toLowerCase(), valid],
    [` ${valid.slice(0, 3)}-${valid.slice(3)} `, valid],
    [`https://dijitalasistan.app/r/${valid}`, valid],
    [`https://dijitalasistan.app/r/${valid.toLowerCase()}?utm=share`, valid],
  ])('%j → %s', (input, expected) => {
    expect(normalizeReferralCode(input)).toBe(expected);
    expect(validateReferralCode(input)).toEqual({ valid: true, code: expected });
  });

  it.each([
    ['ABC', 'length'],
    [`${valid}2`, 'length'],
    ['O0I1L22', 'alphabet'],
    [`${valid.slice(0, 6)}${valid.charAt(6) === '2' ? '3' : '2'}`, 'checksum'],
  ])('%j is invalid (%s)', (input, reason) => {
    expect(validateReferralCode(input)).toEqual({ valid: false, reason });
  });

  it('builds the share link', () => {
    expect(referralShareUrl('https://dijitalasistan.app/', valid)).toBe(
      `https://dijitalasistan.app/r/${valid}`,
    );
  });
});

describe('randomIndexFromBytes (crypto byte source, rejection sampling)', () => {
  it('maps bytes uniformly and skips the biased tail', () => {
    const bytes = [250, 255, 10, 40];
    const random = randomIndexFromBytes(() => bytes.shift() ?? 0);
    // 256 - (256 % 31) = 248: 250 and 255 are rejected, 10 → 10
    expect(random(31)).toBe(10);
    expect(random(31)).toBe(9);
    expect(() => random(0)).toThrow(RangeError);
    expect(() => random(300)).toThrow(RangeError);
  });

  it('produces valid codes', () => {
    let counter = 0;
    const code = generateReferralCode(randomIndexFromBytes(() => (counter += 37) % 256));
    expect(isValidReferralCode(code)).toBe(true);
  });
});
