/**
 * T-8.08 · Today with populated data (SCREEN_AND_FLOW_MAP M-TD-01 hero modes A, sections B,
 * M-TD-02 correction sheet, M-TD-04 snooze sheet): each hero mode rendered from RPC-04
 * `today_overview` + today's briefings at its time of day (gates, midday / evening briefings,
 * generating, failed with retry, pre-morning, silent day, no sources) with its primary and listen
 * actions; the schedule, deadline, follow-up and digital-life sections with their routes; the
 * weekly card; account alerts; long announcements; the priority card verbs (snooze presets and a
 * custom time, not important, the correction options, follow-up draft) and pull-to-refresh.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import type { BriefingSummary } from '../../src/features/today/data';
import { json, resetAppState, type Responder } from '../helpers/app';
import { bootstrap, errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';
import { emptyTodayOverview } from '../helpers/postgrest';
import { back, nth, pullToRefresh } from './support';

const mockClock = { now: '2026-09-24T06:30:00Z' };
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date(mockClock.now),
}));

const DAY = '2026-09-24';
const B = { morning: uuid(1100), midday: uuid(1101), evening: uuid(1102), weekly: uuid(1103) };
const P = {
  reply: uuid(1110),
  followUp: uuid(1111),
  deadline: uuid(1112),
  noTarget: uuid(1113),
  person: uuid(1114),
  sixth: uuid(1115),
};
const MSG = uuid(1120);
const THREAD = uuid(1121);
const EVENT = uuid(1122);
const LIFE = uuid(1123);

function briefing(id: string, kind: string, overrides: Partial<BriefingSummary> = {}) {
  return {
    id,
    kind,
    local_date: DAY,
    status: 'ready',
    origin: 'scheduled',
    headline: null,
    generated_at: '2026-09-24T05:00:00Z',
    evening_ready_at: null,
    audio_status: 'ready',
    audio_duration_s: 240,
    skipped_reason: null,
    weekly_stats: null,
    ...overrides,
  };
}

function priority(id: string, kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    urgency: 'today',
    title: `${kind} başlığı`,
    body: 'Kısa açıklama',
    why_important: null,
    decision_tier: 'ai_classification',
    entity_type: null,
    entity_id: null,
    due_at: null,
    event_at: null,
    user_corrected: false,
    source: {
      source_type: 'email_message',
      source_id: MSG,
      provider: 'google',
      source_timestamp: '2026-09-24T05:40:00Z',
    },
    ...overrides,
  };
}

const PRIORITIES = [
  priority(P.reply, 'reply_needed', {
    urgency: 'urgent',
    title: 'Teklif yanıtı bekleniyor',
    entity_type: 'email_message',
    entity_id: MSG,
    why_important: 'Mehmet Bey iki kez sordu.',
  }),
  priority(P.followUp, 'follow_up', {
    title: 'Ayşe yanıt vermedi',
    entity_type: 'email_thread',
    entity_id: THREAD,
  }),
  priority(P.deadline, 'deadline', {
    title: 'Sözleşme son günü',
    due_at: '2026-09-24T14:00:00Z',
    source: null,
  }),
  priority(P.noTarget, 'digest', { title: 'Kaynaksız konu', source: null }),
  priority(P.person, 'reply_needed', {
    title: 'VIP adayı',
    entity_type: 'contact',
    entity_id: uuid(1130),
  }),
  priority(P.sixth, 'deadline', { title: 'Altıncı konu', source: null }),
];

function overview(overrides: Record<string, unknown> = {}) {
  return {
    ...emptyTodayOverview(DAY),
    hero_count: 6,
    priorities: PRIORITIES,
    next_meeting: {
      id: EVENT,
      title: 'Müşteri toplantısı',
      start_at: '2026-09-24T11:00:00Z',
      end_at: '2026-09-24T12:00:00Z',
      location: null,
      is_online: true,
      attendee_count: 4,
      prep_status: null,
    },
    deadlines: [
      { insight_id: P.deadline, title: 'Sözleşme son günü', due_at: '2026-09-24T14:00:00Z' },
      { insight_id: uuid(1140), title: 'Vergi beyannamesi', due_at: '2026-09-30T09:00:00Z' },
    ],
    follow_ups: [
      { insight_id: uuid(1141), title: 'Kerem teklife dönmedi', entity_id: null, due_at: null },
    ],
    life_intel: [
      ['flight', 'İstanbul → Ankara uçuşu'],
      ['shipment', 'Kargon dağıtımda'],
      ['payment', 'Elektrik faturası'],
      ['reservation', 'Akşam yemeği rezervasyonu'],
      ['security', 'Yeni cihaz girişi'],
      ['subscription', 'Abonelik yenileniyor'],
    ].map(([type, title], i) => ({
      id: i === 0 ? LIFE : uuid(1150 + i),
      type,
      title,
      event_at: i === 0 ? '2026-09-25T06:00:00Z' : null,
      due_at: null,
    })),
    ...overrides,
  };
}

interface Options {
  readonly at?: string;
  readonly pro?: boolean;
  readonly data?: BootstrapData;
  readonly briefings?: readonly Readonly<Record<string, unknown>>[];
  readonly overview?: Record<string, unknown>;
  readonly routes?: Readonly<Record<string, Responder>>;
}

async function openToday(options: Options = {}) {
  mockClock.now = options.at ?? '2026-09-24T06:30:00Z';
  const data = options.data ?? (options.pro === true ? proBootstrap() : bootstrap());
  const opened = await openApp({
    data,
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    setup: (db) => {
      db.setRpc('today_overview', () => ({ data: overview(options.overview), error: null }));
      db.setTable('briefings', options.briefings ?? [briefing(B.morning, 'morning')]);
      db.setRpc('set_insight_status', { ok: true });
      db.setRpc('apply_insight_feedback', { feedback_id: uuid(1160) });
    },
  });
  await waitFor(() => {
    expect(events('today_viewed')).toHaveLength(1);
  });
  return opened;
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-TD-01-A · hero modes', () => {
  it('morning ready: opens the briefing and gates listening for Free users', async () => {
    const { router } = await openToday();
    const hero = screen.getByTestId('today.hero');
    expect(
      within(hero).getByText('2 önemli mail · 1 etkinlik · 1 takip · 2 son tarih'),
    ).toBeOnTheScreen();
    await fireEvent.press(within(hero).getByText('Dinle · 4 dk'));
    expect(await screen.findByTestId('sheet.proGate')).toBeOnTheScreen();
    expect(events('today_hero_cta').at(-1)?.props).toEqual({
      mode: 'morning_ready',
      cta: 'listen',
    });
    await fireEvent.press(within(hero).getByText('Brifingimi Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${B.morning}`);
    });
  });

  it('morning ready (Pro): listening opens the player with autoplay', async () => {
    const { router } = await openToday({ pro: true });
    await fireEvent.press(within(screen.getByTestId('today.hero')).getByText('Dinle · 4 dk'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${B.morning}/listen`);
    });
    expect(router.getSearchParams()).toMatchObject({ autoplay: '1' });
  });

  it('shows the midday and evening gates to Free users', async () => {
    await openToday({ at: '2026-09-24T10:30:00Z' });
    expect(screen.getByTestId('today.hero.gate')).toBeOnTheScreen();
    expect(screen.getByText('Sabahından beri 6 gelişme oldu.')).toBeOnTheScreen();
  });

  it('shows the evening gate after the evening briefing time', async () => {
    await openToday({ at: '2026-09-24T17:00:00Z' });
    expect(screen.getByTestId('today.hero.gate')).toBeOnTheScreen();
    expect(screen.getByText('Yarına kalanlar'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
  });

  it('midday ready (Pro) opens the midday briefing', async () => {
    const { router } = await openToday({
      at: '2026-09-24T10:30:00Z',
      pro: true,
      briefings: [
        briefing(B.morning, 'morning'),
        briefing(B.midday, 'midday', { generated_at: '2026-09-24T10:00:00Z' }),
      ],
    });
    await fireEvent.press(screen.getByText('Nabzı Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${B.midday}`);
    });
  });

  it('evening ready and confirmed (Pro) open the evening closing', async () => {
    const { router } = await openToday({
      at: '2026-09-24T17:00:00Z',
      pro: true,
      briefings: [briefing(B.evening, 'evening')],
    });
    expect(screen.getByText(/Bugünden yarına/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Kapanışı Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${B.evening}`);
    });
  });

  it('evening confirmed says when the morning briefing arrives', async () => {
    await openToday({
      at: '2026-09-24T17:00:00Z',
      pro: true,
      overview: { hero_count: 0, priorities: [] },
      briefings: [briefing(B.evening, 'evening', { evening_ready_at: '2026-09-24T16:30:00Z' })],
    });
    // The time takes its locative suffix ("08:00'de"), never the bare time.
    expect(screen.getByText("Sabah brifingin 08:00'de hazır olacak.")).toBeOnTheScreen();
  });

  it('generating, pre-morning and failed briefings', async () => {
    await openToday({
      at: '2026-09-24T04:30:00Z',
      briefings: [briefing(B.morning, 'morning', { status: 'generating' })],
    });
    expect(screen.getByText('BRİFİNG HAZIRLANIYOR…')).toBeOnTheScreen();
  });

  it('pre-morning names the briefing time and today’s count', async () => {
    await openToday({ at: '2026-09-24T04:00:00Z', briefings: [] });
    expect(screen.getByText("Brifingin 08:00'de hazır olacak.")).toBeOnTheScreen();
    expect(screen.getByText('Şimdiden 6 konu var.')).toBeOnTheScreen();
  });

  it('a failed morning briefing retries with POST /briefings/:id/retry', async () => {
    const { api } = await openToday({
      briefings: [briefing(B.morning, 'morning', { status: 'failed' })],
      routes: {
        [`POST /briefings/${B.morning}/retry`]: () =>
          json(202, ok({ briefing_id: B.morning, status: 'generating' })),
      },
    });
    expect(screen.getByText('Brifing hazırlanamadı.')).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByTestId('today.hero')).getByText('Tekrar Dene'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/briefings/${B.morning}/retry`))).toBe(true);
    });
  });

  it('silent day without a briefing and no sources without accounts', async () => {
    await openToday({
      data: bootstrap({
        preferences: { ...bootstrap().preferences, briefing_weekdays: [1, 2, 3, 5] },
      }),
    });
    expect(screen.getByText('Bugün brifing yok.')).toBeOnTheScreen();
  });

  it('asks to connect an account when there is no source', async () => {
    const { router } = await openToday({ data: bootstrap({ accounts: [] }) });
    await fireEvent.press(screen.getByText('Hesap Bağla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });
});

describe('M-TD-01-B · sections', () => {
  it('opens the meeting, weekly summary, life events and the flow from their sections', async () => {
    const { router } = await openToday({
      briefings: [
        briefing(B.morning, 'morning'),
        briefing(B.weekly, 'weekly', { weekly_stats: { mails_analyzed: 120, time_saved_min: 95 } }),
      ],
    });
    expect(screen.getByText('Bu hafta 120 mail analiz edildi.')).toBeOnTheScreen();
    expect(screen.getByText('4 kişi')).toBeOnTheScreen();
    // Priority deadlines are not repeated in the deadline list.
    expect(
      within(screen.getByTestId('today.deadlines')).queryByText('Sözleşme son günü'),
    ).toBeNull();
    const cases: [() => Promise<void>, string][] = [
      [() => fireEvent.press(screen.getByTestId('today.meeting')), `/event/${EVENT}`],
      [() => fireEvent.press(screen.getByTestId('today.weekly')), `/weekly/${B.weekly}`],
      [() => fireEvent.press(screen.getByText('İstanbul → Ankara uçuşu')), `/life/${LIFE}`],
      [() => fireEvent.press(screen.getByTestId('today.capture')), '/capture'],
    ];
    for (const [press, path] of cases) {
      await press();
      await waitFor(() => {
        expect(router.getPathname()).toBe(path);
      });
      await back();
    }
    await fireEvent.press(screen.getByTestId('today.seeAll'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/flow');
    });
    expect(events('today_section_tapped').map((e) => e.props.section)).toEqual([
      'meeting',
      'life',
      'priorities',
    ]);
  });

  it('explains deadlines and follow-ups in the why sheet', async () => {
    const { db } = await openToday();
    db.setRpc('get_explanation', {
      reason_text: 'Vergi son günü yaklaşıyor.',
      decision_tier: 'deterministic_signal',
      rule: null,
      learned_preference: null,
      confidence: 0.99,
      sources: [],
    });
    await fireEvent.press(screen.getByText('Vergi beyannamesi'));
    expect(await screen.findByText('Vergi son günü yaklaşıyor.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Kerem teklife dönmedi'));
    await waitFor(() => {
      expect(events('today_section_tapped').map((e) => e.props.section)).toEqual([
        'deadline',
        'follow_up',
      ]);
    });
  });

  it('shows account alerts: reconnect and admin consent', async () => {
    const reauth = { ...googleAccount, status: 'needs_reauth' as const };
    const { router } = await openToday({ data: bootstrap({ accounts: [reauth] }) });
    const alert = await screen.findByTestId('today.alert');
    expect(within(alert).getByText('Gmail bağlantısı yenilenmeli.')).toBeOnTheScreen();
    await fireEvent.press(within(alert).getByText('Yeniden Bağlan'));
    expect(events('account_alert_action').at(-1)?.props).toEqual({
      code: 'needs_reauth',
      action: 'reconnect',
    });
    await fireEvent.press(within(alert).getByText('Sonra'));
    await waitFor(() => {
      expect(screen.queryByTestId('today.alert')).toBeNull();
    });
    expect(router.getPathname()).toBe('/today');
  });

  it('routes an admin-consent alert to the account details', async () => {
    const admin = {
      ...googleAccount,
      provider: 'microsoft' as const,
      status: 'admin_consent_required' as const,
    };
    const { router } = await openToday({ data: bootstrap({ accounts: [admin] }) });
    await fireEvent.press(within(await screen.findByTestId('today.alert')).getByText('Ayrıntılar'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/settings/accounts/${googleAccount.id}`);
    });
  });

  it('expands a long announcement and opens its in-app route', async () => {
    const { router } = await openToday({
      data: bootstrap({
        announcements: [
          {
            id: uuid(1170),
            title: 'Yeni özellik',
            body: 'Takvim zekâsı artık boş zamanlarını da gösteriyor. '.repeat(4),
            cta_route: null,
            ends_at: null,
          },
          {
            id: uuid(1171),
            title: 'Bakım',
            body: 'Kısa bakım duyurusu.',
            cta_route: '/settings/notifications',
            ends_at: '2026-09-25T00:00:00Z',
          },
        ],
      }),
    });
    const card = await screen.findByTestId('today.announcement');
    expect(within(card).getByText('Bakım')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Aç'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/notifications');
    });
    expect(events('announcement_cta_tapped')).toHaveLength(1);
  });
});

describe('M-TD-02 / M-TD-04 · priority card verbs', () => {
  it('snoozes to tonight and to a custom time (past times are rejected)', async () => {
    const { db } = await openToday();
    const card = screen.getByTestId(`today.card.${P.reply}`);
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'snooze' } });
    expect(await screen.findByTestId('sheet.snooze')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('snooze.tonight'));
    await waitFor(() => {
      expect(screen.queryByTestId(`today.card.${P.reply}`)).toBeNull();
    });
    expect(events('priority_action').at(-1)?.props).toEqual({
      kind: 'reply_needed',
      action: 'snooze',
    });

    await fireEvent(screen.getByTestId(`today.card.${P.followUp}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'snooze' },
    });
    await fireEvent.press(await screen.findByTestId('snooze.custom'));
    await fireEvent.press(screen.getByTestId('snooze.day.0'));
    expect(await screen.findByTestId('snooze.past')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('snooze.time.21:00'));
    await fireEvent.press(screen.getByTestId('snooze.customSave'));
    await waitFor(() => {
      expect(screen.queryByTestId(`today.card.${P.followUp}`)).toBeNull();
    });
    expect(db.rpcCalls.some((c) => c.name === 'set_insight_status')).toBe(false);
  });

  it('dismisses as not important and teaches through the correction sheet', async () => {
    const { db, router } = await openToday();
    await fireEvent(screen.getByTestId(`today.card.${P.deadline}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'dismiss' },
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`today.card.${P.deadline}`)).toBeNull();
    });
    expect(events('priority_action').at(-1)?.props).toEqual({
      kind: 'deadline',
      action: 'dismiss',
    });

    await fireEvent.press(
      within(screen.getByTestId(`today.card.${P.reply}`)).getByLabelText('Diğer seçenekler'),
    );
    const sheet = await screen.findByTestId('sheet.correction');
    expect(within(sheet).getByText('Neden: Mehmet Bey iki kez sordu.')).toBeOnTheScreen();
    await fireEvent.press(within(sheet).getByTestId('correction.show_more'));
    await waitFor(() => {
      expect(
        db.rpcCalls.filter((c) => c.name === 'apply_insight_feedback').at(-1)?.args,
      ).toMatchObject({ p_insight_id: P.reply });
    });

    await fireEvent.press(
      within(screen.getByTestId(`today.card.${P.followUp}`)).getByLabelText('Diğer seçenekler'),
    );
    await fireEvent.press(nth(await screen.findAllByTestId('correction.source'), -1));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}`);
    });
    await back();

    // "Bu kişiyi VIP yap" is a Pro feature: Free users see the gate.
    await fireEvent.press(
      within(await screen.findByTestId(`today.card.${P.person}`)).getByLabelText(
        'Diğer seçenekler',
      ),
    );
    await fireEvent.press(nth(await screen.findAllByTestId('correction.make_vip'), -1));
    expect(await screen.findByTestId('sheet.proGate')).toBeOnTheScreen();
  });

  it('opens a card without a source screen in the why sheet', async () => {
    const { db } = await openToday();
    db.setRpc('get_explanation', {
      reason_text: 'Kaynağı olmayan bir konu.',
      decision_tier: 'ai_classification',
      rule: null,
      learned_preference: null,
      confidence: 0.5,
      sources: [],
    });
    await fireEvent.press(screen.getByTestId(`today.card.${P.noTarget}`));
    expect(await screen.findByText('Kaynağı olmayan bir konu.')).toBeOnTheScreen();
    expect(events('priority_opened').at(-1)?.props).toEqual({ kind: 'digest' });
  });

  it('drafts a follow-up for Pro (POST /followups/:threadId/draft) and gates it for Free', async () => {
    const draft = {
      id: uuid(1180),
      kind: 'follow_up',
      email_message_id: MSG,
      email_thread_id: THREAD,
      connected_account_id: googleAccount.id,
      tone: 'short',
      subject: 'Re: Teklif',
      to: [{ email: 'ayse@demir.example' }],
      cc: [],
      body_text: 'Merhaba Ayşe Hanım, dönüşünüzü bekliyorum.',
      language: 'tr',
      version: 1,
      status: 'draft',
      attachments: [],
      grounding: { facts_used: [] },
      warnings: [],
      approval_id: null,
      web_link: null,
      created_at: TS,
      updated_at: TS,
    };
    const { router, api } = await openToday({
      pro: true,
      routes: {
        [`POST /followups/${THREAD}/draft`]: () => json(201, ok(draft)),
      },
    });
    await fireEvent.press(
      within(screen.getByTestId(`today.card.${P.followUp}`)).getByText('Takip Mesajı Hazırla'),
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({ mode: 'follow_up', origin: 'today' });
    expect(api.calls.find((c) => c.url.endsWith('/draft'))?.body).toEqual({ tone: 'short' });
  });

  it('gates the follow-up draft for Free users and toasts a failed draft for Pro', async () => {
    await openToday({ routes: {} });
    await fireEvent.press(
      within(screen.getByTestId(`today.card.${P.followUp}`)).getByText('Takip Mesajı Hazırla'),
    );
    expect(await screen.findByTestId('sheet.proGate')).toBeOnTheScreen();
  });

  it('toasts a failed follow-up draft', async () => {
    await openToday({
      pro: true,
      routes: { [`POST /followups/${THREAD}/draft`]: () => json(500, errorBody('INTERNAL_ERROR')) },
    });
    await fireEvent.press(
      within(screen.getByTestId(`today.card.${P.followUp}`)).getByText('Takip Mesajı Hazırla'),
    );
    expect(await screen.findByText('İşlem tamamlanamadı · Tekrar dene')).toBeOnTheScreen();
    expect(events('follow_up_draft_created').at(-1)?.props).toEqual({
      tone: 'short',
      result: 'error',
    });
  });

  it('refreshes by syncing healthy cloud accounts', async () => {
    const { api } = await openToday({
      routes: {
        [`POST /integrations/${googleAccount.id}/sync`]: () =>
          json(202, ok({ job_id: uuid(1190), status: 'queued' })),
      },
    });
    await pullToRefresh('tab.today');
    await waitFor(() => {
      expect(events('today_refreshed').at(-1)?.props).toEqual({ accounts: 1 });
    });
    expect(api.calls.some((c) => c.url.endsWith(`/integrations/${googleAccount.id}/sync`))).toBe(
      true,
    );
    await fireEvent.press(screen.getByLabelText('Profil ve ayarlar'));
    expect(events('avatar_tapped')).toHaveLength(1);
  });
});
