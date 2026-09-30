/**
 * T-8.08 Today (M-TD-01): hero modes in their precedence order, the screen built from RPC-04
 * `today_overview` + today's briefings, the R-06 client undo on "Tamamlandı" (nothing reaches the
 * server while undo is possible), the "why" sheet (RPC-15 `get_explanation`), the announcement
 * dismissal (RPC-14) and the error state with retry.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../src/lib/clock';
import type { BriefingSummary } from '../src/features/today/data';
import { analyticsHeroMode, resolveHero, type HeroInput } from '../src/features/today/hero';
import { resetAppState } from './helpers/app';
import { bootstrap } from './helpers/fixtures';
import { ID, appRouter, events, openApp } from './helpers/journeys';
import { emptyTodayOverview } from './helpers/postgrest';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

// 09:30 in Istanbul on Thursday 24 September 2026: after the morning briefing, before midday.
jest.mock('../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const DAY = '2026-09-24';

function briefing(overrides: Partial<BriefingSummary> = {}): BriefingSummary {
  return {
    id: ID.briefing,
    kind: 'morning',
    local_date: DAY,
    status: 'ready',
    origin: 'scheduled',
    headline: null,
    generated_at: '2026-09-24T05:00:00Z',
    evening_ready_at: null,
    audio_status: null,
    audio_duration_s: null,
    skipped_reason: null,
    weekly_stats: null,
    ...overrides,
  };
}

function heroInput(localTime: string, overrides: Partial<HeroInput> = {}): HeroInput {
  return {
    now: new Date(`${DAY}T${localTime}:00+03:00`),
    prefs: bootstrap().preferences,
    pro: false,
    hasSources: true,
    count: 2,
    localDate: DAY,
    briefings: [briefing()],
    gateDismissed: () => false,
    ...overrides,
  };
}

describe('hero mode (M-TD-01-A)', () => {
  it('follows the precedence order', () => {
    expect(resolveHero(heroInput('09:30', { hasSources: false })).mode).toBe('no_sources');
    expect(
      resolveHero(
        heroInput('09:30', {
          prefs: { ...bootstrap().preferences, briefing_weekdays: [1, 2, 3, 5] },
        }),
      ).mode,
    ).toBe('silent_day');
    expect(resolveHero(heroInput('09:30')).mode).toBe('morning_ready');
    expect(
      resolveHero(heroInput('09:30', { briefings: [briefing({ origin: 'onboarding' })] })).mode,
    ).toBe('first_day');
    expect(
      resolveHero(heroInput('07:30', { briefings: [briefing({ status: 'generating' })] })).mode,
    ).toBe('generating');
    expect(
      resolveHero(heroInput('09:30', { briefings: [briefing({ status: 'failed' })] })).mode,
    ).toBe('morning_failed');
    expect(resolveHero(heroInput('07:00', { briefings: [] })).mode).toBe('pre_morning');
  });

  it('shows the Free midday and evening gates until dismissed, and Pro briefings when ready', () => {
    expect(resolveHero(heroInput('13:30')).mode).toBe('midday_gate');
    expect(resolveHero(heroInput('13:30', { gateDismissed: () => true })).mode).toBe(
      'morning_ready',
    );
    expect(resolveHero(heroInput('13:30', { count: 0 })).mode).toBe('morning_ready');
    const midday = briefing({ id: ID.item, kind: 'midday' });
    expect(
      resolveHero(heroInput('13:30', { pro: true, briefings: [briefing(), midday] })),
    ).toMatchObject({
      mode: 'midday_ready',
      briefing: { id: ID.item },
    });
    const skipped = briefing({ id: ID.item, kind: 'midday', status: 'skipped' });
    expect(
      resolveHero(heroInput('13:30', { pro: true, briefings: [briefing(), skipped] })),
    ).toMatchObject({
      mode: 'morning_ready',
      middaySkipped: true,
    });
    expect(resolveHero(heroInput('20:00')).mode).toBe('evening_gate');
    const evening = briefing({ id: ID.item2, kind: 'evening' });
    expect(resolveHero(heroInput('20:00', { pro: true, briefings: [evening] })).mode).toBe(
      'evening_ready',
    );
    expect(
      resolveHero(
        heroInput('20:00', {
          pro: true,
          briefings: [{ ...evening, evening_ready_at: '2026-09-24T17:10:00Z' }],
        }),
      ).mode,
    ).toBe('evening_confirmed');
  });

  it('runs only the weekend morning on weekends when asked to', () => {
    const saturday = { now: new Date('2026-09-26T13:30:00+03:00'), localDate: '2026-09-26' };
    expect(resolveHero(heroInput('13:30', { ...saturday, briefings: [] })).mode).toBe('day');
    expect(analyticsHeroMode('first_day')).toBe('first_run');
    expect(analyticsHeroMode('silent_day')).toBe('weekend');
    expect(analyticsHeroMode('pre_morning')).toBe('all_clear');
  });
});

const PRIORITY = {
  id: ID.insight,
  kind: 'reply_needed',
  urgency: 'urgent',
  title: 'Teklif onayı bekleniyor',
  body: 'Ayşe Demir yanıt bekliyor',
  why_important: null,
  decision_tier: 'ai_classification',
  entity_type: null,
  entity_id: null,
  due_at: null,
  event_at: null,
  user_corrected: false,
  source: {
    source_type: 'email',
    source_id: ID.item,
    provider: 'google',
    source_timestamp: '2026-09-24T06:10:00Z',
  },
};

function overview(priorities: readonly unknown[] = [PRIORITY]) {
  return { ...emptyTodayOverview(DAY), hero_count: priorities.length, priorities };
}

async function openToday(
  options: { priorities?: readonly unknown[]; announcements?: boolean; failing?: boolean } = {},
) {
  const opened = await openApp({
    data: bootstrap(
      options.announcements === true
        ? {
            announcements: [
              {
                id: ID.announcement,
                title: 'Bakım duyurusu',
                body: 'Bu gece kısa bir bakım yapılacak.',
                cta_route: null,
                ends_at: null,
              },
            ],
          }
        : {},
    ),
    setup: (db) => {
      db.setRpc('today_overview', () =>
        options.failing === true
          ? { data: null, error: { message: 'INTERNAL' } }
          : { data: overview(options.priorities), error: null },
      );
      db.setTable('briefings', [briefing()]);
    },
  });
  return opened;
}

beforeEach(async () => {
  await resetAppState();
});

describe('Today (M-TD-01)', () => {
  it('renders the ready hero and the priority cards from today_overview', async () => {
    const { db } = await openToday();
    expect(await screen.findByTestId(`today.card.${ID.insight}`)).toBeOnTheScreen();
    expect(screen.getByText('Teklif onayı bekleniyor')).toBeOnTheScreen();
    expect(screen.getByText(/^BRİFİNG HAZIR/)).toBeOnTheScreen();
    expect(db.rpcCalls.find((c) => c.name === 'today_overview')?.args).toEqual({
      p_local_date: DAY,
    });
    await waitFor(() => {
      expect(events('today_viewed')[0]?.props).toMatchObject({
        hero_mode: 'morning_ready',
        priorities_count: 1,
      });
    });
  });

  it('opens the Approval Center from the pill and the reminder sheet from "Hatırlat" (T-8.18)', async () => {
    const opened = await openApp({
      setup: (db) => {
        db.setRpc('today_overview', () => ({
          data: { ...overview(), pending_approvals_count: 2 },
          error: null,
        }));
        db.setTable('briefings', [briefing()]);
      },
    });
    const card = await screen.findByTestId(`today.card.${ID.insight}`);
    await fireEvent.press(within(card).getByText('Hatırlat'));
    await waitFor(() => {
      expect(opened.router.getPathname()).toBe('/reminders/new');
    });
    expect(opened.router.getSearchParams()).toMatchObject({
      targetType: 'insight',
      targetId: ID.insight,
      origin: 'today',
    });
    expect(events('priority_action')[0]?.props).toEqual({ kind: 'reply_needed', action: 'remind' });
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByTestId('today.approvals'));
    await waitFor(() => {
      expect(opened.router.getPathname()).toBe('/approvals');
    });
  });

  it('shows the calm empty state without priorities', async () => {
    await openToday({ priorities: [] });
    expect(await screen.findByTestId('today.empty')).toBeOnTheScreen();
    expect(screen.getByText(/^Bugün bilmen gereken yeni bir şey yok/)).toBeOnTheScreen();
  });

  it('hides a completed card at once and sends nothing while undo is possible (R-06)', async () => {
    const { db } = await openToday();
    const card = await screen.findByTestId(`today.card.${ID.insight}`);
    await fireEvent.press(within(card).getByLabelText('Tamamlandı'));
    await waitFor(() => {
      expect(screen.queryByTestId(`today.card.${ID.insight}`)).toBeNull();
    });
    expect(events('priority_complete')[0]?.props).toMatchObject({
      kind: 'reply_needed',
      via: 'button',
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    expect(await screen.findByTestId(`today.card.${ID.insight}`)).toBeOnTheScreen();
    expect(db.rpcCalls.some((c) => c.name === 'set_insight_status')).toBe(false);
    expect(events('priority_undo')[0]?.props).toEqual({ action: 'done' });
  });

  it('opens the why sheet from "Kaynağı Gör" with get_explanation', async () => {
    const { db } = await openToday();
    db.setRpc('get_explanation', {
      reason_text: 'Ayşe bu teklifi iki kez sordu.',
      decision_tier: 'ai_classification',
      rule: null,
      learned_preference: null,
      confidence: 0.92,
      sources: [],
    });
    const card = await screen.findByTestId(`today.card.${ID.insight}`);
    await fireEvent.press(within(card).getByText('Kaynağı Gör'));
    expect(await screen.findByText('Ayşe bu teklifi iki kez sordu.')).toBeOnTheScreen();
    expect(db.rpcCalls.find((c) => c.name === 'get_explanation')?.args).toEqual({
      p_target_type: 'insight',
      p_target_id: ID.insight,
    });
  });

  it('dismisses an announcement for good with dismiss_announcement', async () => {
    const { db } = await openToday({ announcements: true });
    expect(await screen.findByTestId('today.announcement')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Duyuruyu kapat'));
    await waitFor(() => {
      expect(screen.queryByTestId('today.announcement')).toBeNull();
    });
    expect(db.rpcCalls.find((c) => c.name === 'dismiss_announcement')?.args).toEqual({
      p_announcement_id: ID.announcement,
    });
    expect(events('announcement_dismissed')).toHaveLength(1);
  });

  it('shows the error state and recovers on retry', async () => {
    const { db } = await openToday({ failing: true });
    expect(await screen.findByTestId('today.error')).toBeOnTheScreen();
    db.setRpc('today_overview', overview());
    await fireEvent.press(within(screen.getByTestId('today.error')).getByText('Tekrar Dene'));
    expect(await screen.findByTestId(`today.card.${ID.insight}`)).toBeOnTheScreen();
  });
});
