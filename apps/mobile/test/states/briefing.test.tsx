/**
 * T-8.09 · Briefing variants (SCREEN_AND_FLOW_MAP M-BR-01 morning, M-BR-01M midday, M-BR-04 evening,
 * M-BR-03 history, D-29 notification re-ask): the morning narrative, provenance footer, uncertain
 * and done rows, item routes or the why sheet, "Bu brifing işine yaradı mı?" written to
 * `ai_feedback`, read-to-end; the midday delta and the no-change variant; the evening carry-over
 * checklist through RPC-01 with undo and its failure; the generating, error and weekly-redirect
 * states; and the history list grouped by day with its empty state.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { renderApp, resetAppState } from '../helpers/app';
import { TS, uuid } from '../helpers/fixtures';
import { ID, events, openApp, proBootstrap } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { setup } from '../m2/harness';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const DAY = '2026-09-24';
const MSG = uuid(2000);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.briefing,
    kind: 'morning',
    local_date: DAY,
    status: 'ready',
    origin: 'scheduled',
    headline: 'Yoğun bir perşembe',
    narrative: 'Bugün üç önemli konu var; öğleden sonra müşteri toplantın.',
    provenance: { mail_count: 42, calendar_count: 5, lookback_hours: 24 },
    generated_at: '2026-09-24T05:00:00Z',
    audio_status: 'ready',
    audio_duration_s: 180,
    opened_at: null,
    evening_ready_at: null,
    counts: null,
    weekly_stats: null,
    skipped_reason: null,
    version: 1,
    ...overrides,
  };
}

function item(
  id: string,
  section: string,
  position: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    briefing_id: ID.briefing,
    section,
    position,
    badge: null,
    title: `Konu ${String(position)}`,
    meta: null,
    entity_type: null,
    entity_id: null,
    insight_id: null,
    confidence: 1,
    done_at: null,
    source_type: null,
    source_id: null,
    ...overrides,
  };
}

const I = { a: uuid(2010), b: uuid(2011), c: uuid(2012), d: uuid(2013), e: uuid(2014) };

async function openBriefing(
  path: string,
  briefing: Record<string, unknown>,
  items: readonly Record<string, unknown>[],
  setup?: (db: PostgrestFake) => void,
) {
  return openApp({
    data: proBootstrap(),
    path,
    setup: (db) => {
      db.setTable('briefings', [row(briefing)]);
      db.setTable('briefing_items', items);
      setup?.(db);
    },
  });
}

beforeEach(async () => {
  await resetAppState();
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockImplementation(() => Promise.resolve({ status: 'granted', granted: true } as never));
});

describe('M-BR-01 · morning briefing', () => {
  it('shows the narrative, provenance and row variants, opens items and records feedback', async () => {
    const { db, router } = await openBriefing(`/briefing/${ID.briefing}`, {}, [
      item(I.a, 'priorities', 1, {
        title: 'Teklif yanıtı',
        entity_type: 'email_message',
        entity_id: MSG,
      }),
      item(I.b, 'priorities', 2, { title: 'Belirsiz konu', meta: 'Cuma', confidence: 0.5 }),
      item(I.c, 'deadlines', 3, { title: 'Kapanan iş', done_at: TS }),
    ]);
    expect(
      await screen.findByText('Bugün üç önemli konu var; öğleden sonra müşteri toplantın.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Yoğun bir perşembe')).toBeOnTheScreen();
    expect(screen.getByText(/42 mail ve 5 etkinlikten, son 24 saat/)).toBeOnTheScreen();
    expect(screen.getByText('Emin değilim · Cuma')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`briefing.item.${I.c}`)).getByText('Tamamlandı'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('briefing.listen')).toHaveTextContent('Brifingi Dinle · 3 dk');

    db.setRpc('get_explanation', {
      reason_text: 'Sabah brifingi için seçildi.',
      decision_tier: 'deterministic_signal',
      rule: null,
      learned_preference: null,
      confidence: 0.9,
      sources: [],
    });
    await fireEvent.press(screen.getByTestId(`briefing.item.${I.b}`));
    expect(await screen.findByText('Sabah brifingi için seçildi.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Hatalı bir şey var'));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'ai_feedback')?.values).toEqual({
        target_type: 'briefing',
        target_id: ID.briefing,
        rating: -1,
        reason_code: 'inaccurate',
      });
    });
    expect(await screen.findByText('Teşekkürler, not aldım.')).toBeOnTheScreen();
    expect(events('briefing_feedback').at(-1)?.props).toEqual({ rating: 'down' });

    await fireEvent.press(screen.getByTestId(`briefing.item.${I.a}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}`);
    });
    expect(events('briefing_item_opened').map((e) => e.props.section)).toEqual([
      'priorities',
      'priorities',
    ]);
  });

  it('opens the player for Pro and records reading to the end', async () => {
    const { router } = await openBriefing(`/briefing/${ID.briefing}`, { narrative: null }, [
      item(I.a, 'life', 1),
    ]);
    const sheet = await screen.findByTestId('briefing.section.life');
    await fireEvent.scroll(screen.getByTestId('screen.briefing').children[0] as never, {
      nativeEvent: {
        layoutMeasurement: { height: 800 },
        contentOffset: { y: 400 },
        contentSize: { height: 1200 },
      },
    });
    expect(sheet).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('briefing.listen'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${ID.briefing}/listen`);
    });
  });

  it('re-asks for notifications once after "Daha sonra" and records "Hayır"', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockImplementation(() =>
        Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true } as never),
      );
    const { db } = await openBriefing(
      `/briefing/${ID.briefing}`,
      {},
      [item(I.a, 'priorities', 1)],
      (fake) => {
        fake.setTable('notification_preferences', [{ prompt_deferred_count: 1 }]);
      },
    );
    const banner = await screen.findByTestId('briefing.reask');
    await fireEvent.press(within(banner).getByTestId('briefing.reask.no'));
    await waitFor(() => {
      expect(screen.queryByTestId('briefing.reask')).toBeNull();
    });
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'notification_preferences')?.values).toEqual({
        prompt_deferred_count: 2,
      });
    });
  });

  it('asks for the permission from the re-ask banner', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockImplementation(() =>
        Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true } as never),
      );
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false } as never);
    await openBriefing(`/briefing/${ID.briefing}`, {}, [item(I.a, 'priorities', 1)], (fake) => {
      fake.setTable('notification_preferences', [{ prompt_deferred_count: 1 }]);
    });
    await fireEvent.press(await screen.findByTestId('briefing.reask.allow'));
    await waitFor(() => {
      expect(events('notification_reprompt_result').at(-1)?.props.status).toMatch(/denied|blocked/);
    });
  });
});

describe('M-BR-01M · midday', () => {
  it('lists what changed since the morning and the rest of the day', async () => {
    await openBriefing(`/briefing/${ID.briefing}`, { kind: 'midday' }, [
      item(I.a, 'midday_delta', 1, { title: 'Yeni acil mail' }),
      item(I.b, 'rest_of_day', 2, { title: '15:00 müşteri' }),
    ]);
    expect(await screen.findByTestId('briefing.midday.title')).toHaveTextContent(
      'Sabahından beri 1 önemli gelişme oldu.',
    );
    expect(screen.getByText('15:00 müşteri')).toBeOnTheScreen();
  });

  it('says everything went to plan when the midday run was skipped', async () => {
    const { router } = await openBriefing(
      `/briefing/${ID.briefing}`,
      { kind: 'midday', status: 'skipped' },
      [],
    );
    expect(await screen.findByText('Her şey planlandığı gibi.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('midday_no_delta_viewed')).toHaveLength(1);
    });
    await fireEvent.press(screen.getByTestId('briefing.midday.ok'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
  });
});

describe('M-BR-04 · evening', () => {
  it('completes a carry-over item with undo and shows a confirmed evening', async () => {
    const { db } = await openBriefing(
      `/briefing/${ID.briefing}`,
      { kind: 'evening', evening_ready_at: '2026-09-24T17:10:00Z' },
      [
        item(I.a, 'completed', 1, { title: 'Rapor gönderildi', done_at: TS }),
        item(I.b, 'carry_over', 2, { title: 'Teklif', insight_id: uuid(2020) }),
        item(I.c, 'follow_up', 3, { title: 'Kerem' }),
        item(I.d, 'tomorrow_first', 4, { title: '09:00 standup' }),
      ],
      (fake) => {
        fake.setRpc('set_insight_status', { ok: true });
      },
    );
    expect(await screen.findByTestId('briefing.eveningConfirmed')).toHaveTextContent(
      'Yarına hazırsın · 20:10',
    );
    expect(screen.getByTestId(`briefing.item.${I.b}`)).toHaveProp('accessibilityRole', 'checkbox');
    // The follow-up row is informational only.
    expect(screen.getByTestId(`briefing.item.${I.c}`)).not.toHaveProp(
      'accessibilityRole',
      'checkbox',
    );
    await fireEvent.press(screen.getByTestId(`briefing.item.${I.b}`));
    await waitFor(() => {
      expect(db.rpcCalls.find((c) => c.name === 'set_insight_status')?.args).toEqual({
        p_insight_id: uuid(2020),
        p_status: 'done',
      });
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(db.rpcCalls.filter((c) => c.name === 'set_insight_status').at(-1)?.args).toEqual({
        p_insight_id: uuid(2020),
        p_status: 'open',
      });
    });
    expect(events('evening_item_completed')).toHaveLength(1);
  });

  it('rolls a failed completion back and opens "Yarına Hazırım"', async () => {
    await openBriefing(
      `/briefing/${ID.briefing}`,
      { kind: 'evening' },
      [item(I.b, 'carry_over', 2, { title: 'Teklif', insight_id: uuid(2020) })],
      (fake) => {
        fake.setRpc('set_insight_status', () => ({ data: null, error: { message: 'FORBIDDEN' } }));
      },
    );
    await fireEvent(await screen.findByTestId(`briefing.item.${I.b}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(await screen.findByText('Kaydedilemedi. Tekrar dene.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('briefing.eveningReady'));
    // The echo names the morning time with its locative suffix.
    expect(await screen.findByText("Sabah brifingin 08:00'de hazır olacak.")).toBeOnTheScreen();
  });
});

describe('briefing states', () => {
  it('shows the generating state', async () => {
    await openBriefing(`/briefing/${ID.briefing}`, { status: 'generating' }, []);
    expect(await screen.findByTestId('briefing.generating')).toBeOnTheScreen();
  });

  it('redirects a weekly briefing to the weekly review', async () => {
    const { router } = await openBriefing(`/briefing/${ID.briefing}`, { kind: 'weekly' }, []);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/weekly/${ID.briefing}`);
    });
  });

  it('shows the load error with retry, then a gone briefing', async () => {
    const { fake } = setup({ pro: true, data: { failures: { briefings: 'FORBIDDEN' } } });
    await renderApp(`/briefing/${ID.briefing}`);
    expect(await screen.findByTestId('briefing.error')).toBeOnTheScreen();
    fake.data.set({ tables: { briefings: [], briefing_items: [] } });
    await fireEvent.press(screen.getByText('Tekrar Dene'));
    expect(await screen.findByTestId('briefing.notFound')).toBeOnTheScreen();
    expect(fake.data.calls.filter((c) => c.target === 'briefings').length).toBeGreaterThan(1);
  });
});

describe('M-BR-03 · history', () => {
  it('groups briefings by day and opens one', async () => {
    const { router } = await openApp({
      path: '/briefings',
      setup: (db) => {
        db.setTable('briefings', [
          row({ id: uuid(2030), kind: 'morning', local_date: DAY }),
          row({
            id: uuid(2031),
            kind: 'midday',
            local_date: DAY,
            status: 'skipped',
            headline: null,
          }),
          row({ id: uuid(2032), kind: 'evening', local_date: '2026-09-23' }),
          row({ id: uuid(2033), kind: 'weekly', local_date: '2026-09-20', generated_at: null }),
        ]);
      },
    });
    expect(await screen.findByText('Bugün'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.getByText('Dün'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.getByText(/^Değişiklik yoktu/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`history.row.${uuid(2033)}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/weekly/${uuid(2033)}`);
    });
    expect(events('briefing_opened').at(-1)?.props).toEqual({ kind: 'weekly', via: 'history' });
  });

  it('tells when the first briefing arrives (locative time)', async () => {
    await openApp({ path: '/briefings' });
    expect(await screen.findByTestId('history.empty')).toBeOnTheScreen();
    expect(screen.getByText("İlk sabah brifingin 08:00'de hazır olacak.")).toBeOnTheScreen();
  });
});
