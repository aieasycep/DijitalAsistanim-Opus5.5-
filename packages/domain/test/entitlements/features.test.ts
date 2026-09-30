import { describe, expect, it } from 'vitest';
import { effectiveEntitlement } from '../../src/entitlements/effective.ts';
import {
  ENTITLEMENT_FEATURES,
  ENTITLEMENT_FEATURE_GATES,
  FREE_FEATURES,
  PRO_FEATURES,
  checkFeature,
  isFeatureAllowed,
} from '../../src/entitlements/features.ts';
import {
  PLAN_FEATURE_KEYS,
  parsePlanLimitRows,
  planFor,
  type PlanLimits,
} from '../../src/entitlements/limits.ts';
import { PLAN_LIMIT_SEED_ROWS, seedWith } from './plan-limits.fixture.ts';

function load(rows = PLAN_LIMIT_SEED_ROWS): PlanLimits {
  const parsed = parsePlanLimitRows(rows);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.limits;
}
const limits = load();

describe('UT-ENT-09 feature gate map (M§15 / M§44)', () => {
  it('Free list: morning briefing, basic Today, important mail, weekly review, 1 mail account, 1 calendar', () => {
    expect([...FREE_FEATURES].sort()).toEqual(
      [
        'basic_today',
        'calendars',
        'important_mail',
        'mail_accounts',
        'morning_briefing',
        'weekly_review',
      ].sort(),
    );
  });

  it('Pro list: midday, evening, meeting prep, follow-up, commitments, voice, AI memory, VIP, advanced planning, capture, Android NI', () => {
    expect([...PRO_FEATURES].sort()).toEqual(
      [
        'advanced_planning',
        'ai_memory',
        'android_ni',
        'capture',
        'commitments',
        'evening_briefing',
        'follow_up',
        'meeting_prep',
        'midday_briefing',
        'vip',
        'voice_briefing',
      ].sort(),
    );
  });

  it('every Pro feature is backed by a plan_limits feature switch and every switch is used', () => {
    const used = new Set<string>();
    for (const feature of ENTITLEMENT_FEATURES) {
      const gate = ENTITLEMENT_FEATURE_GATES[feature];
      if (gate.kind === 'plan_feature') used.add(gate.planKey);
    }
    expect([...used].sort()).toEqual([...PLAN_FEATURE_KEYS].sort());
  });

  it.each(ENTITLEMENT_FEATURES.map((f) => [f] as const))(
    '%s: Pro allowed; Free allowed only when in the Free list',
    (feature) => {
      expect(isFeatureAllowed(feature, { plan: 'pro', limits, current: 0 })).toBe(true);
      expect(isFeatureAllowed(feature, { plan: 'free', limits, current: 0 })).toBe(
        FREE_FEATURES.includes(feature),
      );
    },
  );
});

describe('UT-ENT-10 plan limits drive ENTITLEMENT_REQUIRED', () => {
  it('Free connecting a second mail account → ENTITLEMENT_REQUIRED with the plan_limits value', () => {
    expect(checkFeature('mail_accounts', { plan: 'free', limits, current: 1 })).toEqual({
      allowed: false,
      code: 'ENTITLEMENT_REQUIRED',
      details: { feature: 'mail_accounts', limit_key: 'max_mail_accounts', limit: 1, current: 1 },
    });
    expect(checkFeature('mail_accounts', { plan: 'free', limits, current: 0 })).toEqual({
      allowed: true,
    });
    expect(checkFeature('mail_accounts', { plan: 'pro', limits, current: 1 })).toEqual({
      allowed: true,
    });
  });

  it('a second selected calendar on Free is refused with max_calendars', () => {
    expect(checkFeature('calendars', { plan: 'free', limits, current: 1 })).toMatchObject({
      allowed: false,
      details: { feature: 'calendars', limit_key: 'max_calendars', limit: 1 },
    });
  });

  it('a Pro-only feature on Free reports the feature key', () => {
    expect(checkFeature('meeting_prep', { plan: 'free', limits })).toEqual({
      allowed: false,
      code: 'ENTITLEMENT_REQUIRED',
      details: { feature: 'meeting_prep' },
    });
  });

  it('the limit is read from plan_limits, not hard-coded', () => {
    const twoAccounts = load(seedWith('free', 'max_mail_accounts', 2));
    expect(
      checkFeature('mail_accounts', { plan: 'free', limits: twoAccounts, current: 1 }),
    ).toEqual({ allowed: true });
    const midday = load(seedWith('free', 'midday_evening', true));
    expect(isFeatureAllowed('midday_briefing', { plan: 'free', limits: midday })).toBe(true);
    const noCapture = load(seedWith('pro', 'capture', false));
    expect(isFeatureAllowed('capture', { plan: 'pro', limits: noCapture })).toBe(false);
  });

  it('gates follow the effective entitlement end to end (grant expiry downgrades to Free)', () => {
    const grants = [
      {
        source: 'referral_referee' as const,
        starts_at: '2026-09-20T00:00:00Z',
        ends_at: '2026-10-04T00:00:00Z',
        revoked_at: null,
      },
    ];
    const during = effectiveEntitlement({
      subscription: null,
      grants,
      now: new Date('2026-10-01T00:00:00Z'),
    });
    const after = effectiveEntitlement({
      subscription: null,
      grants,
      now: new Date('2026-10-04T00:00:00Z'),
    });
    expect(isFeatureAllowed('voice_briefing', { plan: planFor(during), limits })).toBe(true);
    expect(isFeatureAllowed('voice_briefing', { plan: planFor(after), limits })).toBe(false);
  });
});
