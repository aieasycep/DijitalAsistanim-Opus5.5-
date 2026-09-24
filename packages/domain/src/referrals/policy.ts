/**
 * Referral parameters. The yearly cap comes from `plan_limits.referral_rewards_per_year` (R-22);
 * the other values come from `app_settings` (`referral.*`, DATABASE_AND_RLS_PLAN §4.7, editable in
 * backoffice Settings). `REFERRAL_SETTING_DEFAULTS` are the documented seed values, used for any
 * `referral.*` setting that is absent from `app_settings`.
 */

export interface ReferralPolicy {
  /** `plan_limits.referral_rewards_per_year`: rewarded referrals per referrer, rolling 365 days. */
  rewardsPerYear: number;
  /** `referral.reward_days`: Pro days per side. */
  rewardDays: number;
  /** `referral.min_account_age_hours`: referee account age before qualification. */
  minAccountAgeHours: number;
  /** `referral.velocity_max_per_hour`: codes applied per referrer per hour before `flagged`. */
  velocityMaxPerHour: number;
  /** `referral.risk_threshold`: risk score (0–100) at or above which a referral is `flagged`. */
  riskThreshold: number;
  /** `referral.apply_window_days`: a code can be applied only this long after sign-up. */
  applyWindowDays: number;
  /** JOB-25: unqualified referrals are rejected (`qualification_timeout`) after this many days. */
  qualificationWindowDays: number;
  /** JOB-25: an unqualified referral is re-evaluated after this many hours. */
  recheckAfterHours: number;
}

export const REFERRAL_SETTING_DEFAULTS: Omit<ReferralPolicy, 'rewardsPerYear'> = {
  rewardDays: 14,
  minAccountAgeHours: 48,
  velocityMaxPerHour: 3,
  riskThreshold: 50,
  applyWindowDays: 7,
  qualificationWindowDays: 30,
  recheckAfterHours: 12,
};

const SETTING_KEYS: Readonly<Record<keyof typeof REFERRAL_SETTING_DEFAULTS, string>> = {
  rewardDays: 'referral.reward_days',
  minAccountAgeHours: 'referral.min_account_age_hours',
  velocityMaxPerHour: 'referral.velocity_max_per_hour',
  riskThreshold: 'referral.risk_threshold',
  applyWindowDays: 'referral.apply_window_days',
  qualificationWindowDays: 'referral.qualification_window_days',
  recheckAfterHours: 'referral.recheck_after_hours',
};

/**
 * Builds the policy from `app_settings` values (key → JSON value) and the referrer plan's
 * `referral_rewards_per_year`. Non-numeric or negative settings are ignored in favour of the seed.
 */
export function referralPolicyFromSettings(
  settings: Readonly<Record<string, unknown>>,
  rewardsPerYear: number,
): ReferralPolicy {
  if (!Number.isInteger(rewardsPerYear) || rewardsPerYear < 0) {
    throw new RangeError('rewardsPerYear must be a non-negative integer');
  }
  const policy: ReferralPolicy = { ...REFERRAL_SETTING_DEFAULTS, rewardsPerYear };
  for (const field of Object.keys(SETTING_KEYS) as (keyof typeof SETTING_KEYS)[]) {
    const value = settings[SETTING_KEYS[field]];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) policy[field] = value;
  }
  return policy;
}
