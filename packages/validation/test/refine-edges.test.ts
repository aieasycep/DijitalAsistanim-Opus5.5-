/**
 * Remaining refine/consistency branches (TEST_PLAN §16: validation 95/90/95): weekly review and
 * stats (UT-WKR), the OAuth callback deep link (OAUTH-01..04, R-07), the device calendar snapshot
 * window (API-INT-06), Gmail push decoding (WH-GMAIL) and Android NI signal freshness (API-ANI-01).
 */
import { describe, expect, it } from 'vitest';

import {
  refineWeeklyReviewV1,
  refineWeeklyStatsV1,
  type WeeklyReviewV1,
  type WeeklyStatsV1,
} from '../src/ai/index.ts';
import { aniSignalFresh } from '../src/api/android-ni.ts';
import { OAuthCallbackDeepLinkQuery } from '../src/api/integrations.ts';
import { decodeBase64Utf8, parseGmailPush } from '../src/webhooks/pubsub.ts';
import * as F from './fixtures/ai-fixtures.ts';
import { withPath } from './fixtures/samples.ts';

const review = F.weeklyReview as WeeklyReviewV1;
const stats = F.weeklyStats as WeeklyStatsV1;
const ctx = { aliases: ['s1', 's2', 's3', 'f1', 'i2'] };

describe('refineWeeklyReviewV1 edge cases', () => {
  it('fails when every narrative sentence is empty', () => {
    const empty = withPath(review, 'narrative', [{ text_tr: '   ', refs: ['s1'] }]);
    const result = refineWeeklyReviewV1(empty, ctx);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('narrative_empty');
  });

  it('keeps a null busiest day as null', () => {
    const none = withPath(review, 'busiest_day', null);
    expect(refineWeeklyReviewV1(none, ctx).data.busiest_day).toBeNull();
  });

  it('turns a focus block without a slot or without text into none', () => {
    for (const bad of [
      withPath(review, 'suggestion.slot_ref', null),
      withPath(review, 'suggestion.text_tr', null),
      withPath(review, 'suggestion.slot_ref', 'f9'),
    ]) {
      expect(refineWeeklyReviewV1(bad, ctx).data.suggestion.kind).toBe('none');
    }
  });

  it('clears the slot and text of a non-focus suggestion', () => {
    const stray = withPath(review, 'suggestion', {
      kind: 'none',
      slot_ref: 'f1',
      text_tr: 'Boş bir öneri.',
    });
    expect(refineWeeklyReviewV1(stray, ctx).data.suggestion).toEqual({
      kind: 'none',
      slot_ref: null,
      text_tr: null,
    });
    const clean = withPath(review, 'suggestion', { kind: 'none', slot_ref: null, text_tr: null });
    expect(refineWeeklyReviewV1(clean, ctx).data.suggestion.kind).toBe('none');
  });
});

describe('refineWeeklyStatsV1 edge cases', () => {
  it.each([
    ['deadlines_surfaced_in_time', 4, 'deadlines_surfaced_gt_total'],
    ['time_saved_min', -1, 'time_saved_min_invalid'],
    ['period_start', '15.09.2026', 'period_format'],
    ['period_end', '2026-09-14', 'period_order'],
  ] as const)('%s = %s fails with %s', (path, value, error) => {
    const result = refineWeeklyStatsV1(withPath(stats, path, value));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(error);
  });

  it('accepts a week without a busiest day', () => {
    expect(refineWeeklyStatsV1(withPath(stats, 'busiest_day', null)).ok).toBe(true);
  });
});

describe('OAuthCallbackDeepLinkQuery (R-07: the redirect never carries tokens)', () => {
  const base = { provider: 'google', state_id: '00000000-0000-4000-8000-000000000001' };
  const code = 'A'.repeat(43);

  it('requires a completion code only while confirmation is pending', () => {
    expect(
      OAuthCallbackDeepLinkQuery.safeParse({
        ...base,
        result: 'pending_confirmation',
        completion_code: code,
      }).success,
    ).toBe(true);
    const missing = OAuthCallbackDeepLinkQuery.safeParse({
      ...base,
      result: 'pending_confirmation',
    });
    expect(missing.error?.issues.map((i) => i.message)).toContain('completion_code_required');
  });

  it('rejects a completion code on any other result', () => {
    const results = OAuthCallbackDeepLinkQuery.shape.result.options.filter(
      (r) => r !== 'pending_confirmation',
    );
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const parsed = OAuthCallbackDeepLinkQuery.safeParse({
        ...base,
        result,
        completion_code: code,
      });
      expect(parsed.error?.issues.map((i) => i.message)).toContain('completion_code_unexpected');
    }
  });
});

describe('decodeBase64Utf8 / parseGmailPush', () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

  it('decodes 2-, 3- and 4-byte UTF-8 sequences', () => {
    const text = 'ğ€😀';
    expect(decodeBase64Utf8(Buffer.from(text, 'utf8').toString('base64'))).toBe(text);
  });

  it('returns null for a stray continuation byte, a 5-byte lead or a truncated sequence', () => {
    expect(decodeBase64Utf8(b64([0x80]))).toBeNull();
    expect(decodeBase64Utf8(b64([0xf8, 0x80]))).toBeNull();
    expect(decodeBase64Utf8(b64([0xe2, 0x82]))).toBeNull();
    expect(decodeBase64Utf8(b64([0xc4, 0x41]))).toBeNull();
  });

  it('reports undecodable push data as a data error', () => {
    const body = {
      message: { data: b64([0xff]), messageId: '1', publishTime: '2026-09-24T08:00:00Z' },
      subscription: 'projects/p/subscriptions/s',
    };
    expect(parseGmailPush(body)).toEqual({ success: false, error: 'data' });
  });
});

describe('aniSignalFresh (API-ANI-01: 7-day window, 5 min clock skew)', () => {
  const now = new Date('2026-09-24T08:00:00Z');
  const at = (iso: string) => aniSignalFresh({ posted_at: iso }, now);

  it('accepts a signal inside the window and rejects stale or future ones', () => {
    expect(at('2026-09-24T07:00:00Z')).toBe(true);
    expect(at('2026-09-17T08:00:00Z')).toBe(true);
    expect(at('2026-09-17T07:59:59Z')).toBe(false);
    expect(at('2026-09-24T08:05:00Z')).toBe(true);
    expect(at('2026-09-24T08:05:01Z')).toBe(false);
  });
});
