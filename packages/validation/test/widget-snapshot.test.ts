import { describe, expect, it } from 'vitest';
import {
  WIDGET_SNAPSHOT_MAX_BYTES,
  WidgetSnapshotV1,
  downgradeWidgetSnapshot,
  signedOutWidgetSnapshot,
} from '../src/widget-snapshot.ts';
import { utf8ByteLength } from '../src/analytics-events.ts';
import { widgetSnapshot } from './fixtures/api-fixtures.ts';
import { withPath } from './fixtures/samples.ts';

const titleOnly = WidgetSnapshotV1.parse(widgetSnapshot);
const full = WidgetSnapshotV1.parse({
  ...widgetSnapshot,
  detail_mode: 'full',
  priorities: [
    {
      ...widgetSnapshot.priorities[0],
      title_full: 'Mehmet Yılmaz · revize teklif',
      chip_full: 'Mehmet · 17:00',
    },
  ],
  next_meeting: { ...widgetSnapshot.next_meeting, title_full: 'Ürün gözden geçirme' },
});

describe('WidgetSnapshotV1 (UT-WID-01)', () => {
  it.each([
    ['title_only', titleOnly],
    ['full', full],
    ['signed out', signedOutWidgetSnapshot(new Date('2026-09-24T08:00:00Z'), 'tr')],
    ['generic', downgradeWidgetSnapshot(full, 'generic')],
  ])('accepts a %s snapshot', (_name, value) => {
    expect(WidgetSnapshotV1.safeParse(value).success).toBe(true);
  });

  it.each([
    ['generic with a private title', { ...widgetSnapshot, detail_mode: 'generic' }],
    [
      'title_only with a full title',
      withPath(widgetSnapshot, 'priorities.0.title_full', 'Mehmet Yılmaz'),
    ],
    [
      'title_only without a private title',
      withPath(widgetSnapshot, 'priorities.0.title_private', undefined),
    ],
    [
      'a private title carrying an amount',
      withPath(widgetSnapshot, 'priorities.0.title_private', 'Ödeme · ₺1.842,50'),
    ],
    [
      'a private title carrying an email',
      withPath(widgetSnapshot, 'priorities.0.title_private', 'a@b.co · 17:00'),
    ],
    ['a mail body field', withPath(widgetSnapshot, 'priorities.0.body', 'Merhaba Yunus Bey…')],
    [
      'a web deep link',
      withPath(widgetSnapshot, 'briefing.deeplink', 'https://dijitalasistan.app/briefing'),
    ],
    ['Free with audio minutes', { ...widgetSnapshot, entitlement: 'free', next_meeting: null }],
    [
      'Free with prep ready',
      {
        ...widgetSnapshot,
        entitlement: 'free',
        briefing: { ...widgetSnapshot.briefing, audio_minutes: null },
      },
    ],
    ['signed out with content', { ...widgetSnapshot, state: 'signed_out' }],
    [
      'more than 2 later meetings',
      {
        ...widgetSnapshot,
        later_meetings: [
          widgetSnapshot.next_meeting,
          widgetSnapshot.next_meeting,
          widgetSnapshot.next_meeting,
        ],
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(WidgetSnapshotV1.safeParse(value).success).toBe(false);
  });

  it('stays within the 8 KB budget even at maximum field sizes', () => {
    const wide = (n: number) => 'Ş'.repeat(n);
    const priority = {
      ...full.priorities[0],
      title_full: wide(60),
      chip_full: wide(24),
      title_private: wide(40),
      time_label: wide(40),
      source_label: wide(40),
    };
    const meeting = {
      ...widgetSnapshot.next_meeting,
      time_label: wide(40),
      title_full: wide(60),
      title_private: wide(40),
    };
    const max = {
      ...full,
      etag: 'e'.repeat(128),
      priorities: [priority, priority, priority],
      next_meeting: meeting,
      later_meetings: [meeting, meeting],
    };
    expect(WidgetSnapshotV1.safeParse(max).success).toBe(true);
    expect(utf8ByteLength(JSON.stringify(max))).toBeLessThan(WIDGET_SNAPSHOT_MAX_BYTES);
  });

  it('re-filters offline when the level is lowered, never raises it', () => {
    const lowered = downgradeWidgetSnapshot(full, 'title_only');
    expect(lowered.priorities[0]).not.toHaveProperty('title_full');
    expect(lowered.priorities[0]).not.toHaveProperty('chip_full');
    expect(lowered.priorities[0]?.title_private).toBe('Son tarih · 17:00');
    const generic = downgradeWidgetSnapshot(full, 'generic');
    expect(generic.priorities[0]).not.toHaveProperty('title_private');
    expect(generic.priorities[0]).not.toHaveProperty('source_label');
    expect(downgradeWidgetSnapshot(titleOnly, 'full')).toBe(titleOnly);
  });
});
