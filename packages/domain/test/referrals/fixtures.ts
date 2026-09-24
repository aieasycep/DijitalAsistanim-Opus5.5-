/** Test fixtures for the referral tests: policy seed values and a clean referrer/referee pair. */
import type { ReferralPolicy } from '../../src/referrals/policy.ts';
import type { ReferralPartySignals, RiskInput } from '../../src/referrals/risk.ts';

/** app_settings seed + plan_limits.referral_rewards_per_year = 6 (P-06). */
export const POLICY: ReferralPolicy = {
  rewardsPerYear: 6,
  rewardDays: 14,
  minAccountAgeHours: 48,
  velocityMaxPerHour: 3,
  riskThreshold: 50,
  applyWindowDays: 7,
  qualificationWindowDays: 30,
  recheckAfterHours: 12,
};

/** Anchor A1: Wednesday 2026-09-23 09:00 Europe/Istanbul. */
export const NOW = new Date('2026-09-23T06:00:00Z');

export const REFERRER: ReferralPartySignals = {
  user_id: 'user-referrer',
  email_hash: 'h-email-referrer',
  apple_sub_hash: 'h-apple-referrer',
  installation_hashes: ['h-install-referrer-phone'],
  provider_email_hashes: ['h-mailbox-referrer'],
  network_day_hashes: ['h-net-referrer'],
};

export const REFEREE: ReferralPartySignals = {
  user_id: 'user-referee',
  email_hash: 'h-email-referee',
  apple_sub_hash: null,
  installation_hashes: ['h-install-referee-phone'],
  provider_email_hashes: ['h-mailbox-referee'],
  network_day_hashes: ['h-net-referee'],
  email_is_private_relay: false,
};

/** A clean risk input: nothing shared, no loop, low velocity, cap not reached. */
export function cleanRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    referrer: REFERRER,
    referee: REFEREE,
    siblingReferees: [],
    otherAccountsSharingSignals: 0,
    edges: [{ referrer_id: REFERRER.user_id, referee_id: REFEREE.user_id }],
    referrerAppliedAt: ['2026-09-23T05:30:00Z'],
    referrerRewardedAt: [],
    tombstoneMatch: false,
    now: NOW,
    policy: POLICY,
    ...overrides,
  };
}
