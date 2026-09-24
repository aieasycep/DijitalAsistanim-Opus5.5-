import { REFERRAL_SETTING_DEFAULTS } from '@da/domain/referrals/policy';

/**
 * Referral programme numbers stated on `/terms`, `/r/[code]` and in the FAQ (Part 5 registry
 * R-12). `reward_days`, `apply_window_days` and `min_account_age_hours` are the documented
 * `app_settings` `referral.*` seed values from `@da/domain`; the yearly cap is the seeded
 * `plan_limits.referral_rewards_per_year` (R-22). The referral landing page prefers the live
 * `reward_days` / `apply_window_days` from `GET /referrals/:code` (PUB-04) when it has them.
 */
export const REFERRAL_TERMS = {
  rewardDays: REFERRAL_SETTING_DEFAULTS.rewardDays,
  applyWindowDays: REFERRAL_SETTING_DEFAULTS.applyWindowDays,
  minAccountAgeHours: REFERRAL_SETTING_DEFAULTS.minAccountAgeHours,
  maxRewardsPerYear: 6,
} as const;
