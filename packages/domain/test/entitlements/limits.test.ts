import { describe, expect, it } from 'vitest';
import {
  PLAN_COUNT_LIMIT_KEYS,
  PLAN_DAILY_QUOTA_KEYS,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  PlanLimitMissingError,
  aiBudgetLimits,
  checkPlanLimit,
  isPlanFeatureEnabled,
  isValidPlanLimitValue,
  parsePlanLimitRows,
  planFor,
  readPlanLimit,
  resolveRoutingProfile,
  type PlanLimits,
} from '../../src/entitlements/limits.ts';
import { markdownSection, markdownTable, readRepoFile } from '../rbac/doc-sources.ts';
import { PLAN_LIMIT_SEED_ROWS, seedWith } from './plan-limits.fixture.ts';

function load(rows = PLAN_LIMIT_SEED_ROWS): PlanLimits {
  const parsed = parsePlanLimitRows(rows);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.limits;
}

describe('plan_limits keys and seed (R-22, DATABASE_AND_RLS_PLAN §4.6)', () => {
  const section = markdownSection(
    readRepoFile('docs/DATABASE_AND_RLS_PLAN.md'),
    /^#### `plan_limits`/,
  );

  it('PLAN_LIMIT_KEYS equals the plan_limits.key check constraint', () => {
    const check = /check\(key in \(([^)]*)\)\)/.exec(section)?.[1] ?? '';
    const documented = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(PLAN_LIMIT_KEYS).toEqual(documented);
  });

  it('the test fixture equals the documented seed table', () => {
    const rows = markdownTable(section, (cells) => cells[0] === 'key' && cells[1] === 'free');
    const documented = rows.slice(1).flatMap((row) => {
      const key = row[0] ?? '';
      const parse = (cell: string | undefined): unknown =>
        JSON.parse((cell ?? '').replace(/`/g, ''));
      return [
        { plan: 'free', key, value: parse(row[1]) },
        { plan: 'pro', key, value: parse(row[2]) },
      ];
    });
    expect(PLAN_LIMIT_SEED_ROWS).toEqual(documented);
  });

  it('the R-22 canonical keys are present and Free has the visible 50 units/day', () => {
    for (const key of [
      'max_mail_accounts',
      'max_calendars',
      'ai_daily_budget_units',
      'ai_soft_cap_usd_day',
      'ai_hard_cap_usd_day',
      'ai_hard_cap_usd_month',
      'ai_routing_profile',
    ]) {
      expect(PLAN_LIMIT_KEYS).toContain(key);
    }
    expect(readPlanLimit(load(), 'free', 'ai_daily_budget_units')).toBe(50);
  });

  it('partitions the keys into count, quota and feature groups without overlap', () => {
    const groups = [...PLAN_COUNT_LIMIT_KEYS, ...PLAN_DAILY_QUOTA_KEYS, ...PLAN_FEATURE_KEYS];
    expect(new Set(groups).size).toBe(groups.length);
    for (const key of groups) expect(PLAN_LIMIT_KEYS).toContain(key);
  });
});

describe('value validation (private.valid_plan_limit)', () => {
  it.each([
    ['max_mail_accounts', 1, true],
    ['max_mail_accounts', -1, false],
    ['max_mail_accounts', 1.5, false],
    ['max_mail_accounts', '1', false],
    ['ai_daily_budget_units', null, true],
    ['assistant_retrieval_days', null, true],
    ['backfill_days', null, false],
    ['ai_soft_cap_usd_day', 0.02, true],
    ['ai_soft_cap_usd_day', -0.01, false],
    ['ai_briefing_reserve_ratio', 0.25, true],
    ['ai_briefing_reserve_ratio', 1.5, false],
    ['ai_routing_profile', 'lean', true],
    ['ai_routing_profile', 'fast', false],
    ['meeting_prep', true, true],
    ['meeting_prep', 1, false],
  ] as const)('%s = %j → %s', (key, value, valid) => {
    expect(isValidPlanLimitValue(key, value)).toBe(valid);
  });

  it('reports every invalid row and fails the whole parse', () => {
    const result = parsePlanLimitRows([
      ...PLAN_LIMIT_SEED_ROWS,
      { plan: 'enterprise', key: 'max_mail_accounts', value: 3 },
      { plan: 'free', key: 'unlisted_key', value: 1 },
      { plan: 'pro', key: 'max_mail_accounts', value: 11 },
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { plan: 'enterprise', key: 'max_mail_accounts', problem: 'unknown_plan' },
        { plan: 'free', key: 'unlisted_key', problem: 'unknown_key' },
        { plan: 'pro', key: 'max_mail_accounts', problem: 'duplicate' },
      ],
    });
    expect(parsePlanLimitRows(seedWith('free', 'ai_routing_profile', 'fast'))).toMatchObject({
      ok: false,
      issues: [{ plan: 'free', key: 'ai_routing_profile', problem: 'invalid_value' }],
    });
  });

  it('never falls back to a built-in value when a row is missing', () => {
    const limits = load(PLAN_LIMIT_SEED_ROWS.filter((row) => row.key !== 'max_calendars'));
    expect(() => readPlanLimit(limits, 'free', 'max_calendars')).toThrow(PlanLimitMissingError);
    expect(() => checkPlanLimit(limits, 'pro', 'max_calendars', { used: 0 })).toThrow(
      /pro\.max_calendars/,
    );
  });
});

describe('reading limits for the effective plan', () => {
  const limits = load();

  it('uses the pro row for Pro and the free row otherwise', () => {
    expect(planFor({ entitlement: 'pro' })).toBe('pro');
    expect(planFor({ entitlement: 'free' })).toBe('free');
  });

  it.each([
    ['free', 'max_mail_accounts', 0, true],
    ['free', 'max_mail_accounts', 1, false],
    ['pro', 'max_mail_accounts', 9, true],
    ['pro', 'max_mail_accounts', 10, false],
    ['free', 'max_calendars', 1, false],
    ['free', 'captures_daily', 0, false],
    ['pro', 'captures_daily', 49, true],
    ['free', 'reply_drafts_daily', 4, true],
    ['free', 'reply_drafts_daily', 5, false],
  ] as const)('%s %s with %i used → allowed %s', (plan, key, used, allowed) => {
    expect(checkPlanLimit(limits, plan, key, { used }).allowed).toBe(allowed);
  });

  it('honours an increment larger than one (e.g. transcribe seconds)', () => {
    expect(
      checkPlanLimit(limits, 'free', 'transcribe_seconds_daily', { used: 30, increment: 30 })
        .allowed,
    ).toBe(true);
    expect(
      checkPlanLimit(limits, 'free', 'transcribe_seconds_daily', { used: 31, increment: 30 })
        .allowed,
    ).toBe(false);
  });

  it('reads a changed value instead of a constant (backoffice edits take effect)', () => {
    const raised = load(seedWith('free', 'max_mail_accounts', 2));
    expect(checkPlanLimit(raised, 'free', 'max_mail_accounts', { used: 1 }).allowed).toBe(true);
    const enabled = load(seedWith('free', 'meeting_prep', true));
    expect(isPlanFeatureEnabled(enabled, 'free', 'meeting_prep')).toBe(true);
  });

  it('UT-ENT-11: Free AI budget comes from plan_limits (50 units, $0.02 soft, $0.03 hard per day)', () => {
    expect(aiBudgetLimits(limits, 'free')).toEqual({
      plan: 'free',
      dailyUnits: 50,
      softCapUsdDay: 0.02,
      hardCapUsdDay: 0.03,
      hardCapUsdMonth: 0.9,
      softCapMicrosDay: 20_000,
      hardCapMicrosDay: 30_000,
      hardCapMicrosMonth: 900_000,
      briefingReserveRatio: 0.25,
      routingProfile: 'lean',
    });
  });

  it('UT-ENT-12: Pro AI budget ($0.20 soft, $0.60 hard per day, $6 per month)', () => {
    expect(aiBudgetLimits(limits, 'pro')).toMatchObject({
      softCapUsdDay: 0.2,
      hardCapUsdDay: 0.6,
      hardCapUsdMonth: 6,
      hardCapMicrosMonth: 6_000_000,
      routingProfile: 'balanced',
    });
  });

  it('UT-ENT-14: routing profile per plan; switching a plan to lean needs no code change', () => {
    expect(
      aiBudgetLimits(load(seedWith('pro', 'ai_routing_profile', 'lean')), 'pro').routingProfile,
    ).toBe('lean');
    expect(resolveRoutingProfile('balanced')).toBe('balanced');
    expect(resolveRoutingProfile('lean')).toBe('lean');
    expect(resolveRoutingProfile('fast')).toBe('balanced');
    expect(resolveRoutingProfile(null)).toBe('balanced');
  });

  it('keeps null for a Pro unit budget without a cap', () => {
    expect(
      aiBudgetLimits(load(seedWith('pro', 'ai_daily_budget_units', null)), 'pro').dailyUnits,
    ).toBeNull();
  });
});
