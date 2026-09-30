import { describe, expect, it } from 'vitest';
import { SOURCE_TYPE_VALUES } from '../src/enums.ts';
import {
  clampConfidence,
  isValidEvidence,
  makeProvenance,
  sourceLabel,
  sourceNameKey,
} from '../src/provenance.ts';

const IST = 'Europe/Istanbul';

describe('sourceLabel ("Gmail · Mehmet Yılmaz · 08:42")', () => {
  it('mail from Gmail today', () => {
    expect(
      sourceLabel({
        provider: 'google',
        sourceType: 'email_message',
        person: 'Mehmet Yılmaz',
        at: '2026-09-23T05:42:00Z',
        timeZone: IST,
        now: '2026-09-23T09:00:00Z',
      }),
    ).toBe('Gmail · Mehmet Yılmaz · 08:42');
  });

  it('another day adds the short date; English names', () => {
    expect(
      sourceLabel({
        provider: 'microsoft',
        sourceType: 'calendar_event',
        at: '2026-09-21T11:30:00Z',
        timeZone: IST,
        now: '2026-09-23T09:00:00Z',
      }),
    ).toBe('Outlook Takvim · 21 Eyl 14:30');
    expect(
      sourceLabel({
        provider: 'google',
        sourceType: 'calendar_event',
        at: '2026-09-23T11:30:00Z',
        timeZone: IST,
        locale: 'en',
      }),
    ).toBe('Google Calendar · 14:30');
  });

  it('uses the resolver when given', () => {
    const label = sourceLabel(
      {
        provider: 'apple_device',
        sourceType: 'device_calendar_event',
        at: '2026-09-23T06:00:00Z',
        timeZone: IST,
        person: '  ',
      },
      (key) => `[${key}]`,
    );
    expect(label).toBe('[common.source.apple_calendar] · 09:00');
  });

  it('every source type has a name', () => {
    for (const t of SOURCE_TYPE_VALUES) {
      for (const p of [
        'google',
        'microsoft',
        'apple_device',
        'android_device',
        'demo',
        'in_app',
        null,
      ] as const) {
        expect(sourceNameKey(p, t)).toMatch(/^[a-z_]+$/);
      }
    }
    expect(sourceNameKey('google', 'task')).toBe('google_tasks');
    expect(sourceNameKey('microsoft', 'task')).toBe('microsoft_todo');
    expect(sourceNameKey(null, 'task')).toBe('in_app');
    expect(sourceNameKey('android_device', 'calendar_event')).toBe('device_calendar');
  });
});

describe('provenance', () => {
  it('builds a valid row', () => {
    const p = makeProvenance({
      sourceType: 'email_message',
      sourceId: 'm-1',
      sourceProvider: 'google',
      sourceTimestamp: '2026-09-23T05:42:00Z',
      confidence: 0.91234,
      evidence: [{ quote: 'x'.repeat(400), field: 'due_at' }],
    });
    expect(p.confidence).toBe(0.912);
    expect(p.evidence[0]?.quote).toHaveLength(300);
    expect(p.source_timestamp).toBe('2026-09-23T05:42:00.000Z');
  });

  it('user_input may have no provider; others must', () => {
    expect(
      makeProvenance({
        sourceType: 'user_input',
        sourceId: 'u',
        sourceProvider: null,
        sourceTimestamp: 0,
        confidence: 1,
      }).source_provider,
    ).toBeNull();
    expect(() =>
      makeProvenance({
        sourceType: 'email_message',
        sourceId: 'm',
        sourceProvider: null,
        sourceTimestamp: 0,
        confidence: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      makeProvenance({
        sourceType: 'email_message',
        sourceId: '',
        sourceProvider: 'google',
        sourceTimestamp: 0,
        confidence: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      makeProvenance({
        sourceType: 'nope' as never,
        sourceId: 'x',
        sourceProvider: 'google',
        sourceTimestamp: 0,
        confidence: 1,
      }),
    ).toThrow(RangeError);
  });

  it('valid_evidence mirror', () => {
    expect(isValidEvidence([])).toBe(true);
    expect(isValidEvidence([{ quote: 'a', field: 'f', locator: 'm1:0-1' }])).toBe(true);
    expect(isValidEvidence([{ quote: '', field: 'f' }])).toBe(false);
    expect(isValidEvidence([{ quote: 'a', field: 'f', body: 'x' }])).toBe(false);
    expect(isValidEvidence(new Array(6).fill({ quote: 'a', field: 'f' }))).toBe(false);
    expect(isValidEvidence({})).toBe(false);
    expect(isValidEvidence([null])).toBe(false);
  });

  it('clamps confidence', () => {
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
    expect(clampConfidence(Number.NaN)).toBe(0);
  });
});
