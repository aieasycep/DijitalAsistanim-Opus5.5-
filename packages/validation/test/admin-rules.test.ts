import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_1024_MODELS,
  FORBIDDEN_MODEL_FAMILIES,
  ModelConfigPatch,
  isForbiddenModel,
  modelConfigViolations,
} from '../src/admin/ai.ts';
import { EmailMasked, adminListQuery } from '../src/admin/common.ts';
import { flagPayloadValid, isAiFlagKey, isKillSwitchKey } from '../src/admin/product.ts';
import { PLAN_LIMIT_VALUE_SCHEMAS, appSettingValueValid } from '../src/admin/system.ts';
import { isLimitedGrantAllowed } from '../src/admin/users.ts';
import { pricingDisplayUsable, supportReferenceFromAddress } from '../src/public/schemas.ts';
import { pricing } from './fixtures/public-fixtures.ts';

const forbidden = `claude-${FORBIDDEN_MODEL_FAMILIES[0]}-5-1`;
const REASON = 'Model değişikliği test edildi.';

describe('AI model config rules (ADM-08, R-01, R-02)', () => {
  it('recognises forbidden model families only', () => {
    expect(isForbiddenModel(forbidden)).toBe(true);
    expect(isForbiddenModel('claude-haiku-4-5-20251001')).toBe(false);
    expect(isForbiddenModel('gpt-5.6-luna')).toBe(false);
  });

  it('flags fixture targets in production and non-1024-d embedding models', () => {
    const patch = ModelConfigPatch.parse({
      primary_target: { provider: 'fixture', model: 'fixture-v1' },
      expected_version: 1,
      reason: REASON,
      confirm: true,
    });
    expect(modelConfigViolations('email_triage', patch, true)).toEqual(['fixture_in_production']);
    expect(modelConfigViolations('email_triage', patch, false)).toEqual([]);
    const embedding = ModelConfigPatch.parse({
      primary_target: { provider: 'openai', model: 'text-embedding-3-large' },
      expected_version: 1,
      reason: REASON,
      confirm: true,
    });
    expect(modelConfigViolations('embedding_doc', embedding, false)).toEqual([
      'embedding_dimensions',
    ]);
    expect(EMBEDDING_1024_MODELS).toContain('voyage-4');
  });
});

describe('grants, flags and settings', () => {
  it('limits entitlements.grant_limited to 1/7 days from support', () => {
    expect(
      isLimitedGrantAllowed({ duration_days: 7, source: 'support', reason: REASON, confirm: true }),
    ).toBe(true);
    expect(
      isLimitedGrantAllowed({
        duration_days: 14,
        source: 'support',
        reason: REASON,
        confirm: true,
      }),
    ).toBe(false);
    expect(
      isLimitedGrantAllowed({
        duration_days: 1,
        source: 'compensation',
        reason: REASON,
        confirm: true,
      }),
    ).toBe(false);
  });

  it('classifies flag keys and validates known payloads', () => {
    expect(isAiFlagKey('ai.feature.reply_draft')).toBe(true);
    expect(isAiFlagKey('voice.tts_premium')).toBe(true);
    expect(isAiFlagKey('feature.midday')).toBe(false);
    expect(isKillSwitchKey('ai.global.enabled')).toBe(true);
    expect(isKillSwitchKey('ai.feature.assistant_qa')).toBe(true);
    expect(isKillSwitchKey('feature.old_banner')).toBe(false);
    expect(flagPayloadValid('feature.android_ni', { denylist: ['com.google.android.gms'] })).toBe(
      true,
    );
    expect(flagPayloadValid('feature.android_ni', { denylist: ['bad package!'] })).toBe(false);
    expect(flagPayloadValid('feature.midday', null)).toBe(true);
  });

  it('validates app settings per key and refuses unknown keys', () => {
    expect(appSettingValueValid('session.idle_minutes', 30)).toBe(true);
    expect(appSettingValueValid('session.idle_minutes', 90)).toBe(false);
    expect(appSettingValueValid('web.pricing_display', pricing)).toBe(true);
    expect(appSettingValueValid('app.unknown', 1)).toBe(false);
  });

  it('covers every R-22 plan_limits key', () => {
    for (const key of [
      'max_mail_accounts',
      'max_calendars',
      'ai_daily_budget_units',
      'ai_soft_cap_usd_day',
      'ai_hard_cap_usd_day',
      'ai_hard_cap_usd_month',
      'ai_routing_profile',
    ]) {
      expect(Object.keys(PLAN_LIMIT_VALUE_SCHEMAS)).toContain(key);
    }
  });
});

describe('admin list queries and masking', () => {
  it('applies page defaults and allow-lists sorts and filters', () => {
    const query = adminListQuery({ sort: ['created_at'], filters: {} });
    expect(query.parse({})).toEqual({ page: 1, page_size: 25, order: 'desc' });
    expect(query.safeParse({ sort: 'email' }).success).toBe(false);
    expect(query.safeParse({ page_size: '100' }).success).toBe(true);
  });

  it('accepts only masked emails', () => {
    expect(EmailMasked.safeParse('yu***@gmail.com').success).toBe(true);
    expect(EmailMasked.safeParse('yunus@gmail.com').success).toBe(false);
  });
});

describe('public-api helpers', () => {
  it('shows prices only when verified and at most 90 days old', () => {
    expect(pricingDisplayUsable(pricing, new Date('2026-09-24T00:00:00Z'))).toBe(true);
    expect(pricingDisplayUsable(pricing, new Date('2027-01-24T00:00:00Z'))).toBe(false);
    expect(
      pricingDisplayUsable({ ...pricing, verified: false }, new Date('2026-09-24T00:00:00Z')),
    ).toBe(false);
  });

  it('extracts a ticket reference from a reply address', () => {
    expect(supportReferenceFromAddress('support+da-7k3m9q@mail.dijitalasistan.app')).toBe(
      'DA-7K3M9Q',
    );
    expect(supportReferenceFromAddress('support@mail.dijitalasistan.app')).toBeNull();
  });
});
