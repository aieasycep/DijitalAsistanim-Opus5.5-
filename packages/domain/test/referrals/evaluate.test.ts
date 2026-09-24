import { describe, expect, it } from 'vitest';
import { REFERRAL_STATUS_VALUES, type ReferralStatus } from '../../src/enums.ts';
import {
  effectiveEntitlement,
  stackGrantWindow,
  type EntitlementGrantRow,
} from '../../src/entitlements/effective.ts';
import { generateReferralCode } from '../../src/referrals/code.ts';
import { referralCreditKey } from '../../src/ids.ts';
import {
  REFERRAL_REJECT_REASONS,
  canTransitionReferral,
  checkReferralApply,
  evaluateReferral,
  planReferralReward,
  reviewFlaggedReferral,
  type ReferralRecord,
} from '../../src/referrals/evaluate.ts';
import {
  REFERRAL_SETTING_DEFAULTS,
  referralPolicyFromSettings,
} from '../../src/referrals/policy.ts';
import { qualify, type RefereeProgress } from '../../src/referrals/qualify.ts';
import { assessReferralRisk } from '../../src/referrals/risk.ts';
import { NOW, POLICY, REFEREE, REFERRER, cleanRiskInput } from './fixtures.ts';

const progress: RefereeProgress = {
  account_created_at: '2026-09-21T06:00:00Z',
  onboarding_completed_at: '2026-09-21T06:10:00Z',
  account_connected_at: '2026-09-21T06:12:00Z',
  first_briefing_delivered_at: '2026-09-22T05:00:00Z',
};
const referral: ReferralRecord = {
  id: 'ref-1',
  status: 'pending',
  applied_at: '2026-09-21T06:05:00Z',
};

function evaluate(record: ReferralRecord, riskOverrides = {}, progressOverrides = {}, now = NOW) {
  return evaluateReferral({
    referral: record,
    risk: assessReferralRisk(cleanRiskInput({ now, ...riskOverrides })),
    qualification: qualify({ ...progress, ...progressOverrides }, now, POLICY),
    now,
    policy: POLICY,
  });
}

describe('referral evaluation (JOB-25)', () => {
  it('a clean referral qualifies exactly once', () => {
    const first = evaluate(referral);
    expect(first).toMatchObject({ action: 'qualify', status: 'qualified' });
    const after: ReferralRecord = {
      ...referral,
      status: first.action === 'qualify' ? first.status : 'pending',
    };
    expect(evaluate(after)).toEqual({ action: 'none', reason: 'not_pending' });
    expect(evaluate({ ...referral, status: 'rewarded' })).toEqual({
      action: 'none',
      reason: 'not_pending',
    });
  });

  it('UT-REF-09 credit keys are referral:{id}:referrer and :referee, identical on re-evaluation', () => {
    const a = evaluate(referral);
    const b = evaluate(referral);
    if (a.action !== 'qualify' || b.action !== 'qualify') throw new Error('expected qualify');
    expect(a.reward.referee.idempotencyKey).toBe('referral:ref-1:referee');
    expect(a.reward.referrer?.idempotencyKey).toBe('referral:ref-1:referrer');
    expect(b.reward).toEqual(a.reward);
    expect(referralCreditKey('ref-1', 'referee')).toBe('referral:ref-1:referee');
  });

  it('UT-REF-05 the 7th qualifying referral in 365 days is qualified, the referrer credit withheld (cap_reached)', () => {
    const rewarded = [
      '2025-10-01',
      '2025-12-01',
      '2026-02-01',
      '2026-04-01',
      '2026-06-01',
      '2026-08-01',
    ].map((d) => `${d}T00:00:00Z`);
    const result = evaluate(referral, { referrerRewardedAt: rewarded });
    expect(result).toMatchObject({
      action: 'qualify',
      status: 'qualified',
      reward: {
        referrer: null,
        referrerWithheld: 'cap_reached',
        referee: { days: 14, grantSource: 'referral_referee' },
      },
    });
  });

  it.each([
    ['self referral', { referee: { ...REFEREE, user_id: REFERRER.user_id } }, 'self_referral'],
    ['loop', { referrer: { ...REFEREE }, referee: { ...REFERRER } }, 'loop'],
    ['tombstone', { tombstoneMatch: true }, 'tombstoned'],
  ] as const)('%s → rejected (%s) even before qualification', (_label, overrides, reason) => {
    expect(evaluate(referral, overrides, { first_briefing_delivered_at: null })).toEqual({
      action: 'reject',
      status: 'rejected',
      rejectReason: reason,
    });
  });

  it('a flagged referral waits for admin review once qualified', () => {
    const result = evaluate(referral, { otherAccountsSharingSignals: 3 });
    expect(result).toMatchObject({ action: 'flag', status: 'flagged' });
  });

  it('an unqualified referral waits: for account age until eligible_after, otherwise 12 h', () => {
    const young = evaluate(referral, {}, {}, new Date('2026-09-23T05:00:00Z'));
    expect(young).toMatchObject({ action: 'wait', recheckAt: '2026-09-23T06:00:00.000Z' });
    const noBriefing = evaluate(referral, {}, { first_briefing_delivered_at: null });
    expect(noBriefing).toMatchObject({ action: 'wait', recheckAt: '2026-09-23T18:00:00.000Z' });
  });

  it('is rejected with qualification_timeout after 30 days without qualifying', () => {
    const late = new Date('2026-10-21T06:05:00Z');
    expect(evaluate(referral, {}, { first_briefing_delivered_at: null }, late)).toEqual({
      action: 'reject',
      status: 'rejected',
      rejectReason: 'qualification_timeout',
    });
  });

  it('rewards stack without overlap for a referrer with several referrals (UT-REF-10)', () => {
    const grants: EntitlementGrantRow[] = [
      {
        source: 'referral_referrer',
        starts_at: '2026-09-17T00:00:00Z',
        ends_at: '2026-10-01T00:00:00Z',
        revoked_at: null,
      },
    ];
    const plan = planReferralReward('ref-2', POLICY, false);
    const window = stackGrantWindow({ grants, now: NOW, days: plan.referrer?.days ?? 0 });
    expect(window).toEqual({
      starts_at: '2026-10-01T00:00:00.000Z',
      ends_at: '2026-10-15T00:00:00.000Z',
    });
    const result = effectiveEntitlement({
      subscription: null,
      grants: [...grants, { source: 'referral_referrer', ...window, revoked_at: null }],
      now: NOW,
    });
    expect(result.expires_at).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('status machine and admin review', () => {
  const legal: [ReferralStatus, ReferralStatus][] = [
    ['pending', 'qualified'],
    ['pending', 'flagged'],
    ['pending', 'rejected'],
    ['flagged', 'qualified'],
    ['flagged', 'rejected'],
    ['qualified', 'rewarded'],
  ];
  it('allows exactly the legal transitions', () => {
    for (const from of REFERRAL_STATUS_VALUES) {
      for (const to of REFERRAL_STATUS_VALUES) {
        const expected = legal.some(([f, t]) => f === from && t === to);
        expect(canTransitionReferral(from, to), `${from}→${to}`).toBe(expected);
      }
    }
  });

  it.each([
    [
      'flagged',
      'approve',
      'Aynı cihaz ama farklı aile üyesi, onaylandı.',
      { ok: true, status: 'qualified', rejectReason: null },
    ],
    [
      'flagged',
      'reject',
      'Toplu hesap açma şüphesi doğrulandı.',
      { ok: true, status: 'rejected', rejectReason: 'admin_rejected' },
    ],
    ['flagged', 'approve', 'kısa', { ok: false, error: 'reason_required' }],
    [
      'pending',
      'approve',
      'Aynı cihaz ama farklı aile üyesi.',
      { ok: false, error: 'not_flagged' },
    ],
  ] as const)('review of a %s referral (%s)', (status, decision, reason, expected) => {
    expect(reviewFlaggedReferral({ status }, decision, reason)).toEqual(expected);
  });

  it('uses only reject reasons allowed by the referrals check constraint', () => {
    expect(REFERRAL_REJECT_REASONS).toContain('qualification_timeout');
    expect(REFERRAL_REJECT_REASONS).toContain('admin_rejected');
  });
});

describe('apply-time checks (API-BIZ-01)', () => {
  const code = generateReferralCode(() => 3);
  const referee = { ...REFEREE, account_created_at: '2026-09-22T06:00:00Z' };
  const base = {
    code,
    codeOwner: REFERRER,
    referee,
    refereeHasReferral: false,
    now: NOW,
    policy: POLICY,
  };

  it('accepts a valid code from another person within the apply window', () => {
    expect(checkReferralApply({ ...base, code: code.toLowerCase() })).toEqual({ ok: true, code });
  });

  it.each([
    ['unknown or disabled code', { codeOwner: null }, 'REFERRAL_CODE_INVALID'],
    ['malformed code', { code: 'O0I1L22' }, 'REFERRAL_CODE_INVALID'],
    ['own code', { codeOwner: { ...REFERRER, user_id: referee.user_id } }, 'REFERRAL_SELF'],
    [
      'same normalised e-mail',
      { codeOwner: { ...REFERRER, email_hash: referee.email_hash } },
      'REFERRAL_SELF',
    ],
    [
      'same Apple relay mapping',
      {
        codeOwner: { ...REFERRER, apple_sub_hash: 'h-apple' },
        referee: { ...referee, apple_sub_hash: 'h-apple' },
      },
      'REFERRAL_SELF',
    ],
    [
      'same device hash',
      { codeOwner: { ...REFERRER, installation_hashes: referee.installation_hashes } },
      'REFERRAL_SELF',
    ],
    ['second application', { refereeHasReferral: true }, 'REFERRAL_ALREADY_APPLIED'],
    [
      'account older than 7 days',
      { referee: { ...referee, account_created_at: '2026-09-16T05:59:00Z' } },
      'REFERRAL_WINDOW_CLOSED',
    ],
  ] as const)('%s → %s', (_label, overrides, error) => {
    expect(checkReferralApply({ ...base, ...overrides })).toEqual({ ok: false, error });
  });
});

describe('policy from settings', () => {
  it('reads referral.* app_settings and requires the plan_limits yearly cap', () => {
    const policy = referralPolicyFromSettings(
      {
        'referral.reward_days': 21,
        'referral.velocity_max_per_hour': 5,
        'referral.risk_threshold': 'high',
      },
      6,
    );
    expect(policy).toEqual({
      ...REFERRAL_SETTING_DEFAULTS,
      rewardsPerYear: 6,
      rewardDays: 21,
      velocityMaxPerHour: 5,
    });
    expect(() => referralPolicyFromSettings({}, -1)).toThrow(RangeError);
  });
});
