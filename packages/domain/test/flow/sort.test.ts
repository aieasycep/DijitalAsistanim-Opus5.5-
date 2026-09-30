import { describe, expect, it } from 'vitest';
import { URGENCY_VALUES } from '../../src/enums.ts';
import {
  FLOW_URGENCY_BUCKET,
  compareFlowItems,
  flowSortKey,
  sortFlowItems,
  type FlowSortable,
} from '../../src/flow/sort.ts';

interface Card extends FlowSortable {
  id: string;
}

const card = (id: string, fields: Omit<Card, 'id'>): Card => ({ id, ...fields });

describe('UT-FLOW-01 Flow order: urgency bucket, then time', () => {
  it('buckets follow urgent → today → normal → low', () => {
    expect(URGENCY_VALUES.map((u) => FLOW_URGENCY_BUCKET[u])).toEqual([0, 1, 2, 3]);
  });

  it('sorts a mixed feed', () => {
    const feed: Card[] = [
      card('low-new', { urgency: 'low', display_at: '2026-09-23T05:00:00Z' }),
      card('normal-old', { urgency: 'normal', display_at: '2026-09-22T08:00:00Z' }),
      card('today-meeting-late', {
        urgency: 'today',
        event_at: '2026-09-23T15:00:00Z',
        display_at: '2026-09-23T04:00:00Z',
      }),
      card('urgent-deadline', {
        urgency: 'urgent',
        due_at: '2026-09-23T09:00:00Z',
        display_at: '2026-09-22T10:00:00Z',
      }),
      card('normal-new', { urgency: 'normal', display_at: '2026-09-23T05:30:00Z' }),
      card('today-deadline-early', {
        urgency: 'today',
        due_at: '2026-09-23T11:00:00Z',
        display_at: '2026-09-23T05:50:00Z',
      }),
      card('urgent-mail', { urgency: 'urgent', display_at: '2026-09-23T05:40:00Z' }),
      card('low-old', { urgency: 'low', display_at: '2026-09-20T05:00:00Z' }),
    ];
    expect(sortFlowItems(feed).map((c) => c.id)).toEqual([
      'urgent-mail',
      'urgent-deadline',
      'today-deadline-early',
      'today-meeting-late',
      'normal-new',
      'normal-old',
      'low-new',
      'low-old',
    ]);
  });

  it.each([
    [
      'urgent/today use the earlier of due_at and event_at',
      {
        urgency: 'today',
        due_at: '2026-09-23T12:00:00Z',
        event_at: '2026-09-23T10:00:00Z',
        display_at: '2026-09-23T01:00:00Z',
      },
      Date.parse('2026-09-23T10:00:00Z'),
      true,
    ],
    [
      'urgent/today without due/event use display_at',
      { urgency: 'urgent', due_at: null, event_at: null, display_at: '2026-09-23T01:00:00Z' },
      Date.parse('2026-09-23T01:00:00Z'),
      true,
    ],
    [
      'normal/low ignore due_at and sort newest first',
      { urgency: 'normal', due_at: '2026-09-24T00:00:00Z', display_at: '2026-09-23T02:00:00Z' },
      Date.parse('2026-09-23T02:00:00Z'),
      false,
    ],
  ] as const)('%s', (_label, item: FlowSortable, at, ascending) => {
    expect(flowSortKey(item)).toMatchObject({ at, ascending });
  });

  it('is stable: equal keys keep their input order', () => {
    const same = { urgency: 'normal', display_at: '2026-09-23T05:00:00Z' } as const;
    const feed = ['a', 'b', 'c', 'd', 'e'].map((id) => card(id, same));
    expect(sortFlowItems(feed).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sortFlowItems([...feed].reverse()).map((c) => c.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
    const tiedDeadlines = ['x', 'y', 'z'].map((id) =>
      card(id, {
        urgency: 'urgent',
        due_at: '2026-09-23T09:00:00Z',
        display_at: `2026-09-2${id === 'y' ? '1' : '2'}T00:00:00Z`,
      }),
    );
    expect(sortFlowItems(tiedDeadlines).map((c) => c.id)).toEqual(['x', 'y', 'z']);
  });

  it('does not mutate the input and agrees with the comparator', () => {
    const feed: Card[] = [
      card('1', { urgency: 'low', display_at: '2026-09-23T05:00:00Z' }),
      card('2', { urgency: 'urgent', display_at: '2026-09-23T05:00:00Z' }),
      card('3', {
        urgency: 'today',
        due_at: '2026-09-23T07:00:00Z',
        display_at: '2026-09-23T05:00:00Z',
      }),
    ];
    const copy = [...feed];
    const sorted = sortFlowItems(feed);
    expect(feed).toEqual(copy);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (prev !== undefined && next !== undefined) {
        expect(compareFlowItems(prev, next)).toBeLessThanOrEqual(0);
      }
    }
  });
});
