import { describe, expect, it } from 'vitest';
import { qualify, type RefereeProgress } from '../../src/referrals/qualify.ts';
import { POLICY } from './fixtures.ts';

const created = '2026-09-21T06:00:00Z';
const complete: RefereeProgress = {
  account_created_at: created,
  onboarding_completed_at: '2026-09-21T06:10:00Z',
  account_connected_at: '2026-09-21T06:12:00Z',
  first_briefing_delivered_at: '2026-09-22T05:00:00Z',
};

describe('referral qualification (plan §16; UT-REF-07)', () => {
  it.each([
    ['47 h 59 m after sign-up: not yet qualified', '2026-09-23T05:59:00Z', false, ['account_age']],
    ['exactly 48 h after sign-up: qualified', '2026-09-23T06:00:00Z', true, []],
    ['later: qualified', '2026-09-25T06:00:00Z', true, []],
  ])('%s', (_label, now, qualified, missing) => {
    const result = qualify(complete, new Date(now), POLICY);
    expect(result.qualified).toBe(qualified);
    expect(result.missing).toEqual(missing);
    expect(result.eligible_after).toBe('2026-09-23T06:00:00.000Z');
  });

  it.each([
    ['onboarding not finished', { onboarding_completed_at: null }, ['onboarding']],
    ['no connected account', { account_connected_at: null }, ['account_connected']],
    ['no delivered briefing', { first_briefing_delivered_at: null }, ['first_briefing']],
    [
      'briefing time in the future does not count',
      { first_briefing_delivered_at: '2026-09-24T05:00:00Z' },
      ['first_briefing'],
    ],
  ] as const)('%s', (_label, change, missing) => {
    const result = qualify({ ...complete, ...change }, new Date('2026-09-23T07:00:00Z'), POLICY);
    expect(result.qualified).toBe(false);
    expect(result.missing).toEqual(missing);
  });

  it('records the referrals.qualification jsonb', () => {
    expect(qualify(complete, new Date('2026-09-23T07:00:00Z'), POLICY).qualification).toEqual({
      onboarding_completed_at: complete.onboarding_completed_at,
      account_connected_at: complete.account_connected_at,
      first_briefing_at: complete.first_briefing_delivered_at,
      account_age_ok: true,
    });
  });

  it('uses the configured minimum age', () => {
    const result = qualify(complete, new Date('2026-09-22T06:00:00Z'), { minAccountAgeHours: 24 });
    expect(result.qualified).toBe(true);
  });

  it('rejects an invalid creation timestamp', () => {
    expect(() => qualify({ ...complete, account_created_at: 'n/a' }, new Date(), POLICY)).toThrow(
      RangeError,
    );
  });
});
