import { describe, expect, it } from 'vitest';
import {
  RISK_WEIGHTS,
  assessReferralRisk,
  risk,
  type RiskInput,
} from '../../src/referrals/risk.ts';
import { REFEREE, REFERRER, cleanRiskInput } from './fixtures.ts';

type Case = [label: string, overrides: Partial<RiskInput>, expected: Record<string, unknown>];

describe('referral anti-abuse risk (UT-REF-01..06, UT-REF-08)', () => {
  it('a clean referral scores 0 and is not flagged', () => {
    expect(assessReferralRisk(cleanRiskInput())).toEqual({
      score: 0,
      signals: [],
      decision: 'clean',
      rejectReason: null,
      flagReasons: [],
      referrerCapReached: false,
    });
    expect(risk).toBe(assessReferralRisk);
  });

  const cases: Case[] = [
    [
      'UT-REF-01 referee user id = referrer id → rejected self_referral',
      { referee: { ...REFEREE, user_id: REFERRER.user_id } },
      { decision: 'rejected', rejectReason: 'self_referral' },
    ],
    [
      'UT-REF-02 same normalised e-mail hash → rejected self_referral',
      { referee: { ...REFEREE, email_hash: REFERRER.email_hash } },
      { decision: 'rejected', rejectReason: 'self_referral' },
    ],
    [
      'UT-REF-03 same Apple sub hash (relay) → flagged shared_device',
      {
        referee: {
          ...REFEREE,
          apple_sub_hash: REFERRER.apple_sub_hash,
          email_is_private_relay: true,
        },
      },
      { decision: 'flagged', flagReasons: ['shared_device'] },
    ],
    [
      'UT-REF-03 same installation hash → flagged shared_device',
      {
        referee: { ...REFEREE, installation_hashes: ['h-other', ...REFERRER.installation_hashes] },
      },
      { decision: 'flagged', flagReasons: ['shared_device'] },
    ],
    [
      'UT-REF-04 loop A→B then B→A → rejected loop',
      {
        referrer: { ...REFEREE },
        referee: { ...REFERRER },
        edges: [{ referrer_id: REFERRER.user_id, referee_id: REFEREE.user_id }],
      },
      { decision: 'rejected', rejectReason: 'loop' },
    ],
    [
      'loop through a chain A→B→C then C→A → rejected loop',
      {
        referrer: { ...REFEREE, user_id: 'user-c' },
        referee: { ...REFERRER },
        edges: [
          { referrer_id: REFERRER.user_id, referee_id: 'user-b' },
          { referrer_id: 'user-b', referee_id: 'user-c' },
        ],
      },
      { decision: 'rejected', rejectReason: 'loop' },
    ],
    [
      'UT-REF-06 fourth code application within 60 min → flagged velocity',
      {
        referrerAppliedAt: [
          '2026-09-23T05:05:00Z',
          '2026-09-23T05:20:00Z',
          '2026-09-23T05:40:00Z',
          '2026-09-23T05:59:00Z',
        ],
      },
      { decision: 'flagged', flagReasons: ['velocity'] },
    ],
    [
      'three applications within 60 min stay clean',
      {
        referrerAppliedAt: [
          '2026-09-23T05:05:00Z',
          '2026-09-23T05:40:00Z',
          '2026-09-23T05:59:00Z',
          '2026-09-23T04:59:00Z',
        ],
      },
      { decision: 'clean', flagReasons: [] },
    ],
    [
      'UT-REF-08 referee signal in privacy_tombstones → rejected tombstoned',
      { tombstoneMatch: true },
      { decision: 'rejected', rejectReason: 'tombstoned' },
    ],
    [
      'duplicate account: installation shared with a sibling referee → flagged duplicate_account',
      {
        siblingReferees: [
          {
            user_id: 'user-sibling',
            email_hash: 'h-sib',
            apple_sub_hash: null,
            installation_hashes: REFEREE.installation_hashes,
          },
        ],
      },
      { decision: 'flagged', flagReasons: ['duplicate_account'] },
    ],
    [
      'duplicate account: referee hashes seen on other accounts → flagged duplicate_account',
      { otherAccountsSharingSignals: 2 },
      { decision: 'flagged', flagReasons: ['duplicate_account'] },
    ],
    [
      'duplicate account: referrer and referee connected the same mailbox → flagged duplicate_account',
      { referee: { ...REFEREE, provider_email_hashes: REFERRER.provider_email_hashes ?? [] } },
      { decision: 'flagged', flagReasons: ['duplicate_account'] },
    ],
    [
      'weak signals alone (same network + relay address) stay below the threshold',
      {
        referee: {
          ...REFEREE,
          network_day_hashes: REFERRER.network_day_hashes ?? [],
          email_is_private_relay: true,
        },
      },
      { decision: 'clean', score: 30, signals: ['shared_network', 'private_relay_email'] },
    ],
    [
      'weak signals reach the threshold when it is lowered → flagged risk_score',
      {
        referee: {
          ...REFEREE,
          network_day_hashes: REFERRER.network_day_hashes ?? [],
          email_is_private_relay: true,
        },
        policy: { velocityMaxPerHour: 3, rewardsPerYear: 6, riskThreshold: 30 },
      },
      { decision: 'flagged', flagReasons: ['risk_score'] },
    ],
  ];

  it.each(cases)('%s', (_label, overrides, expected) => {
    expect(assessReferralRisk(cleanRiskInput(overrides))).toMatchObject(expected);
  });

  it('UT-REF-05 the yearly cap never flags; it marks the referrer cap as reached', () => {
    const rewarded = [
      '2025-10-01',
      '2025-12-01',
      '2026-02-01',
      '2026-04-01',
      '2026-06-01',
      '2026-08-01',
    ].map((d) => `${d}T00:00:00Z`);
    const result = assessReferralRisk(cleanRiskInput({ referrerRewardedAt: rewarded }));
    expect(result).toMatchObject({ decision: 'clean', referrerCapReached: true, score: 0 });
    expect(result.signals).toEqual(['cap_reached']);
    const oneExpired = ['2025-09-22T00:00:00Z', ...rewarded.slice(1)];
    expect(
      assessReferralRisk(cleanRiskInput({ referrerRewardedAt: oneExpired })).referrerCapReached,
    ).toBe(false);
  });

  it('rejections take precedence over flags and the score is capped at 100', () => {
    const result = assessReferralRisk(
      cleanRiskInput({
        referee: { ...REFERRER },
        tombstoneMatch: true,
        otherAccountsSharingSignals: 1,
      }),
    );
    expect(result.decision).toBe('rejected');
    expect(result.rejectReason).toBe('self_referral');
    expect(result.flagReasons).toEqual([]);
    expect(result.score).toBe(100);
  });

  it('documents a weight for every signal', () => {
    expect(Object.keys(RISK_WEIGHTS).sort()).toEqual(
      [
        'cap_reached',
        'duplicate_account',
        'loop',
        'private_relay_email',
        'self_apple_relay',
        'self_email',
        'self_installation',
        'self_user_id',
        'shared_network',
        'tombstoned',
        'velocity',
      ].sort(),
    );
  });
});
