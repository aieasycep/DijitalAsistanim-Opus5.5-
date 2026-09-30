import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ANALYTICS_EVENT_NAME_PATTERN,
  ScreenId,
  auditAnalyticsCatalogue,
  createAnalyticsValidator,
  isBannedPropName,
  looksLikeContact,
  utf8ByteLength,
} from '../src/analytics-events.ts';

/** A catalogue in the shape `@da/domain` generates (event → strict props). */
const catalogue = {
  briefing_open: z.object({ source: z.enum(['push', 'today', 'widget']) }),
  assistant_prompt_sent: z.object({
    suggested: z.boolean(),
    prompt_key: z.enum(['focus_today', 'who_needs_reply']).nullable(),
    input_mode: z.enum(['text', 'voice']),
  }),
  capture_submit_analyze: z.object({
    kind: z.enum(['photo', 'pdf']),
    file_count: z.int().min(0).max(10),
  }),
  meeting_prep_opened: z.object({
    minutes_to_start_bucket: z.enum(['lt15', '15_60', 'gt60']),
    screen: ScreenId.optional(),
  }),
  onboarding_completed: z.object({}),
};

describe('createAnalyticsValidator', () => {
  const validator = createAnalyticsValidator(catalogue);
  const event = (name: string, props?: unknown) => ({
    name,
    ts: '2026-09-24T08:00:00Z',
    ...(props === undefined ? {} : { props }),
  });

  it('accepts catalogue events with typed, content-free props', () => {
    expect(validator.validate(event('briefing_open', { source: 'push' }))).toMatchObject({
      ok: true,
    });
    expect(validator.validate(event('onboarding_completed'))).toMatchObject({ ok: true });
    expect(
      validator.validate(event('capture_submit_analyze', { kind: 'pdf', file_count: 2 })),
    ).toMatchObject({ ok: true });
    expect(validator.eventName.safeParse('briefing_open').success).toBe(true);
  });

  it.each([
    ['an unknown event', event('mail_body_viewed', {}), 'unknown_event'],
    ['a non-snake_case name', event('BriefingOpen'), 'invalid_envelope'],
    [
      'a non-catalogue prop',
      event('briefing_open', { source: 'push', subject: 'x' }),
      'invalid_props',
    ],
    ['a non-enum string', event('briefing_open', { source: 'Mehmet' }), 'invalid_props'],
    [
      'an out-of-range integer',
      event('capture_submit_analyze', { kind: 'pdf', file_count: 99 }),
      'invalid_props',
    ],
    ['an email value', event('briefing_open', { source: 'yunus@example.com' }), 'contact_value'],
    [
      'a URL value',
      event('briefing_open', { source: 'https://evil.example.com' }),
      'contact_value',
    ],
  ])('drops %s', (_name, input, reason) => {
    expect(validator.validate(input)).toEqual({ ok: false, reason });
  });

  it('counts drops per reason in a batch', () => {
    const result = validator.validateBatch([
      event('briefing_open', { source: 'today' }),
      event('nope_event'),
      event('briefing_open', { source: 'x' }),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.dropped).toBe(2);
    expect(result.reasons).toEqual({ unknown_event: 1, invalid_props: 1 });
  });

  it('refuses a batch above 100 events', () => {
    const result = validator.validateBatch(
      Array.from({ length: 101 }, () => event('onboarding_completed')),
    );
    expect(result.accepted).toEqual([]);
    expect(result.reasons.batch_too_large).toBe(101);
  });
});

describe('catalogue audit (SECURITY_AND_PRIVACY_PLAN §4.9)', () => {
  it('passes a compliant catalogue', () => {
    expect(auditAnalyticsCatalogue(catalogue)).toEqual([]);
  });

  it.each([
    ['free text', { search_submitted: z.object({ query_text: z.string() }) }, 'banned_prop_name'],
    ['a free string prop', { tab_opened: z.object({ tab: z.string() }) }, 'free_text'],
    ['an email field', { share_sent: z.object({ email: z.enum(['x']) }) }, 'banned_prop_name'],
    ['an unclamped integer', { list_scrolled: z.object({ count: z.int() }) }, 'unclamped_integer'],
    ['a float', { gauge_read: z.object({ ratio: z.number() }) }, 'unsupported_type'],
    ['a camelCase event', { briefingOpen: z.object({}) }, 'event_name_format'],
    [
      'an over-long enum value',
      { tab_opened: z.object({ tab: z.enum(['x'.repeat(65)]) }) },
      'enum_value_too_long',
    ],
    [
      'a URL enum value',
      { cta_clicked: z.object({ target: z.enum(['https://x.test']) }) },
      'enum_value_contact',
    ],
    [
      'an object prop',
      { filter_set: z.object({ filter: z.object({ a: z.boolean() }) }) },
      'unsupported_type',
    ],
  ])('flags %s', (_name, bad, rule) => {
    expect(auditAnalyticsCatalogue(bad).map((v) => v.rule)).toContain(rule);
    expect(() => createAnalyticsValidator(bad)).toThrow(/privacy rules/);
  });

  it('refuses an empty catalogue', () => {
    expect(() => createAnalyticsValidator({})).toThrow(/empty/);
  });
});

describe('analytics helpers', () => {
  it('matches the analytics_events.event_name check', () => {
    expect(ANALYTICS_EVENT_NAME_PATTERN.test('briefing_open')).toBe(true);
    expect(ANALYTICS_EVENT_NAME_PATTERN.test('ab')).toBe(false);
  });
  it('bans content-bearing names and suffixes but allows enum keys like prompt_key', () => {
    expect(isBannedPropName('sender_email')).toBe(true);
    expect(isBannedPropName('file_url')).toBe(true);
    expect(isBannedPropName('prompt_key')).toBe(false);
    expect(isBannedPropName('faq_id')).toBe(false);
  });
  it('detects contact-like strings', () => {
    expect(looksLikeContact('www.example.com')).toBe(true);
    expect(looksLikeContact('push')).toBe(false);
  });
  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('şğ€😀')).toBe(2 + 2 + 3 + 4);
  });
});
