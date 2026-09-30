import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  effectiveEntitlement,
  entitlementSourceLabel,
  isPro,
  isValidGrantDuration,
  stackGrantWindow,
  type EffectiveEntitlement,
  type EntitlementGrantRow,
} from '../../src/entitlements/effective.ts';
import { GRANT_SOURCE_VALUES, SUBSCRIPTION_STATUS_VALUES } from '../../src/enums.ts';

const Timestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)));
const Vector = z.strictObject({
  id: z.string(),
  case: z.string(),
  now: Timestamp,
  subscription: z
    .strictObject({
      is_active: z.boolean(),
      status: z.enum(SUBSCRIPTION_STATUS_VALUES),
      environment: z.enum(['sandbox', 'production']),
      period_type: z.enum(['normal', 'trial', 'intro', 'prepaid']),
      expires_at: Timestamp.nullable(),
      grace_expires_at: Timestamp.nullable(),
      will_renew: z.boolean(),
    })
    .nullable(),
  grants: z.array(
    z.strictObject({
      source: z.enum(GRANT_SOURCE_VALUES),
      starts_at: Timestamp,
      ends_at: Timestamp,
      revoked_at: Timestamp.nullable(),
    }),
  ),
  ignore_sandbox_store: z.boolean(),
  expected: z.strictObject({
    entitlement: z.enum(['free', 'pro']),
    source: z.enum(['store', 'grant']).nullable(),
    expires_at: Timestamp.nullable(),
    is_trial: z.boolean(),
    will_renew: z.boolean(),
    store_expires_at: Timestamp.nullable(),
    grant_ends_at: Timestamp.nullable(),
  }),
});

const vectors = z
  .strictObject({ description: z.string(), vectors: z.array(Vector) })
  .parse(
    JSON.parse(readFileSync(new URL('../vectors/entitlement.json', import.meta.url), 'utf8')),
  ).vectors;

/** Timestamps compare as instants (the SQL side returns timestamptz text). */
function comparable(e: EffectiveEntitlement): Record<string, unknown> {
  const instant = (s: string | null): number | null => (s === null ? null : Date.parse(s));
  return {
    ...e,
    expires_at: instant(e.expires_at),
    store_expires_at: instant(e.store_expires_at),
    grant_ends_at: instant(e.grant_ends_at),
  };
}

describe('effectiveEntitlement (shared vectors, TEST_PLAN §2.9 / DB-17)', () => {
  it('has unique vector ids covering UT-ENT-01..08', () => {
    const ids = vectors.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let n = 1; n <= 8; n++) expect(ids).toContain(`UT-ENT-0${n}`);
  });

  it.each(vectors.map((v) => [v.id, v.case, v] as const))('%s %s', (_id, _case, vector) => {
    const result = effectiveEntitlement({
      subscription: vector.subscription,
      grants: vector.grants,
      now: new Date(vector.now),
      ignoreSandboxStore: vector.ignore_sandbox_store,
    });
    expect(comparable(result)).toEqual(comparable(vector.expected));
  });

  it('maps the source to the SQL/API spelling', () => {
    expect(entitlementSourceLabel({ source: null })).toBe('none');
    expect(entitlementSourceLabel({ source: 'store' })).toBe('store');
    expect(isPro({ entitlement: 'pro' })).toBe(true);
    expect(isPro({ entitlement: 'free' })).toBe(false);
  });

  it('rejects malformed timestamps instead of guessing', () => {
    expect(() =>
      effectiveEntitlement({
        subscription: null,
        grants: [
          {
            source: 'admin',
            starts_at: 'yesterday',
            ends_at: '2026-10-01T00:00:00Z',
            revoked_at: null,
          },
        ],
        now: new Date('2026-09-23T06:00:00Z'),
      }),
    ).toThrow(RangeError);
  });
});

describe('grant stacking (no overlap)', () => {
  const now = new Date('2026-09-23T06:00:00Z');
  const grant = (
    starts: string,
    ends: string,
    revoked: string | null = null,
  ): EntitlementGrantRow => ({
    source: 'referral_referee',
    starts_at: starts,
    ends_at: ends,
    revoked_at: revoked,
  });

  it('UT-REF-10: an existing grant ending 2026-10-01 → new +14 days runs 2026-10-01 → 2026-10-15', () => {
    const window = stackGrantWindow({
      grants: [grant('2026-09-17T00:00:00Z', '2026-10-01T00:00:00Z')],
      now,
      days: 14,
    });
    expect(window).toEqual({
      starts_at: '2026-10-01T00:00:00.000Z',
      ends_at: '2026-10-15T00:00:00.000Z',
    });
  });

  it.each([
    ['no grants: starts now', [], '2026-09-23T06:00:00.000Z', '2026-09-30T06:00:00.000Z'],
    [
      'ended grant is ignored',
      [grant('2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z')],
      '2026-09-23T06:00:00.000Z',
      '2026-09-30T06:00:00.000Z',
    ],
    [
      'revoked grant is ignored',
      [grant('2026-09-20T00:00:00Z', '2026-10-20T00:00:00Z', '2026-09-21T00:00:00Z')],
      '2026-09-23T06:00:00.000Z',
      '2026-09-30T06:00:00.000Z',
    ],
    [
      'stacks after the latest active or scheduled grant',
      [
        grant('2026-09-20T00:00:00Z', '2026-10-04T00:00:00Z'),
        grant('2026-10-04T00:00:00Z', '2026-10-18T00:00:00Z'),
      ],
      '2026-10-18T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
    ],
  ])('%s', (_label, grants: EntitlementGrantRow[], starts, ends) => {
    expect(stackGrantWindow({ grants, now, days: 7 })).toEqual({
      starts_at: starts,
      ends_at: ends,
    });
  });

  it('three stacked referral rewards extend Pro contiguously without overlap', () => {
    const grants: EntitlementGrantRow[] = [];
    for (let i = 0; i < 3; i++) {
      const window = stackGrantWindow({ grants, now, days: 14 });
      grants.push({ source: 'referral_referrer', ...window, revoked_at: null });
    }
    for (let i = 1; i < grants.length; i++) {
      expect(grants[i]?.starts_at).toBe(grants[i - 1]?.ends_at);
    }
    const result = effectiveEntitlement({ subscription: null, grants, now });
    expect(result).toMatchObject({ entitlement: 'pro', source: 'grant' });
    expect(Date.parse(result.expires_at ?? '')).toBe(now.getTime() + 42 * 24 * 60 * 60 * 1000);
  });

  it('rejects a non-positive duration', () => {
    expect(() => stackGrantWindow({ grants: [], now, days: 0 })).toThrow(RangeError);
  });

  it.each([
    ['admin', 1, true],
    ['admin', 7, true],
    ['support', 14, true],
    ['compensation', 30, true],
    ['admin', 3, false],
    ['support', 60, false],
    ['referral_referee', 14, true],
    ['referral_referrer', 60, true],
    ['referral_referrer', 61, false],
    ['referral_referee', 0, false],
  ] as const)('duration check: %s %i days → %s', (source, days, valid) => {
    expect(isValidGrantDuration(source, days)).toBe(valid);
  });

  it('knows every grant source', () => {
    for (const source of GRANT_SOURCE_VALUES)
      expect(typeof isValidGrantDuration(source, 7)).toBe('boolean');
  });
});
