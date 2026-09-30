/**
 * Test fixture: the `plan_limits` seed rows (DATABASE_AND_RLS_PLAN §4.6 seed table, migration
 * 0009). Production code never contains these values; `limits.test.ts` asserts this fixture equals
 * the documented seed so the fixture cannot drift.
 */
import type { PlanLimitRow } from '../../src/entitlements/limits.ts';

const SEED: Record<string, [unknown, unknown]> = {
  max_mail_accounts: [1, 10],
  max_calendar_accounts: [1, 10],
  max_calendars: [1, 30],
  vip_max: [5, 100],
  priority_rules_max: [10, 200],
  ai_daily_budget_units: [50, 600],
  ai_soft_cap_usd_day: [0.02, 0.2],
  ai_hard_cap_usd_day: [0.03, 0.6],
  ai_hard_cap_usd_month: [0.9, 6],
  ai_briefing_reserve_ratio: [0.25, 0.15],
  ai_routing_profile: ['lean', 'balanced'],
  email_analysis_daily: [150, 1500],
  reply_drafts_daily: [5, 60],
  assistant_messages_daily: [10, 200],
  assistant_retrieval_days: [7, null],
  transcribe_seconds_daily: [60, 1800],
  captures_daily: [0, 50],
  meeting_preps_daily: [0, 30],
  semantic_search_daily: [0, 300],
  backfill_days: [30, 90],
  referral_rewards_per_year: [6, 6],
  meeting_prep: [false, true],
  memory_search: [false, true],
  voice_briefing: [false, true],
  android_ni: [false, true],
  midday_evening: [false, true],
  advanced_planning: [false, true],
  follow_up_commitments: [false, true],
  capture: [false, true],
  vip: [false, true],
};

export const PLAN_LIMIT_SEED_ROWS: readonly PlanLimitRow[] = Object.entries(SEED).flatMap(
  ([key, [free, pro]]) => [
    { plan: 'free', key, value: free },
    { plan: 'pro', key, value: pro },
  ],
);

/** Seed rows with one value replaced, for tests proving a value is read and not hard-coded. */
export function seedWith(plan: 'free' | 'pro', key: string, value: unknown): PlanLimitRow[] {
  return PLAN_LIMIT_SEED_ROWS.map((row) =>
    row.plan === plan && row.key === key ? { ...row, value } : row,
  );
}
