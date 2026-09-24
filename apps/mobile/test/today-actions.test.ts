/**
 * T-8.08 insight actions (§0.5, R-06): "Tamamlandı" hides the card at once and sends RPC-01
 * `set_insight_status` only after the 5 s undo window (undo cancels it); "Önemli değil" calls
 * RPC-21 right away and its undo calls RPC-22 `revert_insight_feedback`.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { qk } from '@da/api-client';

import { applyFeedback, completeInsight, UNDO_WINDOW_MS } from '../src/features/today/actions';
import type { TodayData, TodayPriority } from '../src/features/today/data';
import { getQueryClient } from '../src/lib/query/client';
import type * as ToastModule from '../src/providers/ToastHost';
import { installFakeSupabase, resetAppState } from './helpers/app';
import { session } from './helpers/fixtures';
import { ID } from './helpers/journeys';
import { emptyTodayOverview, type PostgrestFake } from './helpers/postgrest';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const mockToasts: { message: string; action?: { label: string; onPress: () => void } }[] = [];
jest.mock('../src/providers/ToastHost', () => ({
  ...jest.requireActual<typeof ToastModule>('../src/providers/ToastHost'),
  showToast: (toast: { message: string; action?: { label: string; onPress: () => void } }) => {
    mockToasts.push(toast);
  },
}));

const DAY = '2026-09-24';
const ITEM: TodayPriority = {
  id: ID.insight,
  kind: 'deadline',
  urgency: 'today',
  title: 'Sözleşme son günü',
  body: null,
  why_important: null,
  decision_tier: null,
  entity_type: null,
  entity_id: null,
  due_at: '2026-09-24T14:00:00Z',
  event_at: null,
  user_corrected: false,
  source: null,
};

let db: PostgrestFake;

function seed(): void {
  const data: TodayData = {
    overview: { ...emptyTodayOverview(DAY), hero_count: 1, priorities: [ITEM] },
    briefings: [],
  };
  getQueryClient().setQueryData(qk.today.day(DAY), data);
}

function priorities(): readonly TodayPriority[] {
  return getQueryClient().getQueryData<TodayData>(qk.today.day(DAY))?.overview.priorities ?? [];
}

beforeEach(async () => {
  await resetAppState();
  mockToasts.length = 0;
  db = installFakeSupabase(session()).db;
  seed();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('complete with undo (R-06)', () => {
  it('sends set_insight_status only after the undo window', async () => {
    jest.useFakeTimers();
    completeInsight(ITEM, DAY, 'button');
    expect(priorities()).toEqual([]);
    expect(mockToasts[0]?.action?.label).toBe('Geri al');
    jest.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(db.rpcCalls).toEqual([]);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(db.rpcCalls).toEqual([
      { name: 'set_insight_status', args: { p_insight_id: ID.insight, p_status: 'done' } },
    ]);
  });

  it('never sends the write when undone and restores the card', () => {
    jest.useFakeTimers();
    completeInsight(ITEM, DAY, 'swipe');
    mockToasts[0]?.action?.onPress();
    jest.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(db.rpcCalls).toEqual([]);
    expect(priorities().map((p) => p.id)).toEqual([ID.insight]);
  });
});

describe('feedback with revert (RPC-21 / RPC-22)', () => {
  it('applies "Önemli değil" at once and reverts it on undo', async () => {
    db.setRpc('apply_insight_feedback', { feedback_id: ID.item });
    const ok = await applyFeedback(ITEM, DAY, 'not_important', true);
    expect(ok).toBe(true);
    expect(priorities()).toEqual([]);
    expect(db.rpcCalls[0]).toMatchObject({
      name: 'apply_insight_feedback',
      args: { p_insight_id: ID.insight, p_kind: 'not_important' },
    });
    expect(mockToasts[0]?.message).toBe('Öğrendim · Bu tür konuları daha aşağıda göstereceğim.');
    mockToasts[0]?.action?.onPress();
    await Promise.resolve();
    await Promise.resolve();
    expect(db.rpcCalls[1]).toEqual({
      name: 'revert_insight_feedback',
      args: { p_feedback_id: ID.item },
    });
    expect(priorities().map((p) => p.id)).toEqual([ID.insight]);
  });

  it('puts the card back and says so when the feedback fails', async () => {
    db.setRpc('apply_insight_feedback', () => ({ data: null, error: { message: 'INTERNAL' } }));
    const ok = await applyFeedback(ITEM, DAY, 'stop_tracking', true);
    expect(ok).toBe(false);
    expect(priorities().map((p) => p.id)).toEqual([ID.insight]);
    expect(mockToasts[0]?.message).toBe('Kaydedilemedi. Tekrar dene.');
  });
});
