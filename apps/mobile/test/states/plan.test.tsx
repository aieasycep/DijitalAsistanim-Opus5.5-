/**
 * T-8.13 · Plan with populated data (SCREEN_AND_FLOW_MAP M-PLAN-01 Gün, M-PLAN-02 Hafta, M-PLAN-05
 * Boşluk sheet, M-PLAN-06 Görev sheet): one timeline merging events (overlaps marked), commitments,
 * life events, deadlines, dashed proposals (pending / failed) and labelled free gaps with the "now"
 * line; the TÜM GÜN strip; the TAKVİM ZEKÂSI card and the week's Calendar Intelligence cards with
 * their real actions (RPC-01 dismiss, `POST /plan/proposals`, reminder / source sheets, prep and
 * mail routes); the Pro gate for Free users; the empty, no-calendar, error and offline states;
 * strip / week paging and pull-to-refresh (`POST /integrations/:accountId/sync`).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type Responder } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { errorBody, googleAccount, ok, uuid } from '../helpers/fixtures';
import { events, setup } from '../m2/harness';
import { back, nth, pullToRefresh } from './support';

// 09:30 in Istanbul on Thursday 24 September 2026.
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const ID = {
  meeting: uuid(700),
  online: uuid(701),
  proposal: uuid(702),
  failed: uuid(703),
  task: uuid(704),
  commitment: uuid(705),
  life: uuid(706),
  deadline: uuid(707),
  allDay: uuid(708),
  dateTask: uuid(709),
  mail: uuid(710),
  approval: uuid(711),
} as const;

const SIG = {
  conflict: uuid(720),
  suggestion: uuid(721),
  prep: uuid(722),
  backToBack: uuid(723),
  leaveBy: uuid(724),
  deadline: uuid(725),
  extra: uuid(726),
} as const;

const ITEMS = [
  {
    item_type: 'event',
    id: ID.meeting,
    start_at: '2026-09-24T07:00:00Z',
    end_at: '2026-09-24T08:00:00Z',
    all_day: false,
    title: 'Proje görüşmesi',
    attendee_count: 3,
  },
  {
    item_type: 'event',
    id: ID.online,
    start_at: '2026-09-24T07:30:00Z',
    end_at: '2026-09-24T08:30:00Z',
    all_day: false,
    title: 'Ekip senkronu',
    attendee_count: 1,
    is_online: true,
    created_by_assistant: true,
  },
  {
    item_type: 'commitment',
    id: ID.commitment,
    start_at: '2026-09-24T09:00:00Z',
    end_at: null,
    title: 'Teklifi gönder',
    direction: 'user_owes',
  },
  {
    item_type: 'life_event',
    id: ID.life,
    start_at: '2026-09-24T10:00:00Z',
    end_at: null,
    title: 'Kargo teslimatı',
  },
  {
    item_type: 'proposal',
    id: ID.proposal,
    start_at: '2026-09-24T11:00:00Z',
    end_at: '2026-09-24T12:00:00Z',
    title: 'Sunum hazırlığı',
    approval_status: 'pending',
  },
  {
    item_type: 'proposal',
    id: ID.failed,
    start_at: '2026-09-24T13:00:00Z',
    end_at: '2026-09-24T13:30:00Z',
    title: 'Rapor bloğu',
    approval_status: 'failed',
  },
  {
    item_type: 'task',
    id: ID.task,
    start_at: '2026-09-24T14:00:00Z',
    end_at: null,
    title: 'Sunumu bitir',
    source: { provider: 'google' },
  },
  {
    item_type: 'deadline',
    id: ID.deadline,
    start_at: '2026-09-24T14:30:00Z',
    end_at: null,
    title: 'Fatura son günü',
    source: { source_type: 'email_message', source_id: ID.mail, provider: 'google' },
  },
  {
    item_type: 'event',
    id: ID.allDay,
    start_at: '2026-09-23T21:00:00Z',
    end_at: '2026-09-24T21:00:00Z',
    all_day: true,
    title: 'Şirket tatili',
  },
  {
    item_type: 'task',
    id: ID.dateTask,
    start_at: null,
    end_at: null,
    title: 'Vergi beyannamesi',
  },
];

function signal(id: string, kind: string, reason: string, overrides: Record<string, unknown>) {
  return {
    id,
    kind,
    reason_code: reason,
    status: 'open',
    title: `${kind} ${reason}`,
    body: null,
    due_at: null,
    event_at: null,
    entity_type: 'calendar_event',
    entity_id: ID.meeting,
    source_type: 'calendar_event',
    source_id: ID.meeting,
    ...overrides,
  };
}

const SIGNALS = [
  signal(SIG.suggestion, 'schedule_suggestion', 'free_gap', {
    title: 'Sunuma zaman ayır',
    body: 'Yarın 10:00–11:00 boşsun.',
    event_at: '2026-09-25T07:00:00Z',
  }),
  signal(SIG.leaveBy, 'meeting', 'leave_by', {
    title: 'Toplantıya çıkış',
    event_at: '2026-09-24T12:00:00Z',
  }),
  signal(SIG.prep, 'meeting', 'prep_needed', {
    title: 'Proje görüşmesi',
    event_at: '2026-09-25T07:00:00Z',
  }),
  signal(SIG.backToBack, 'meeting', 'back_to_back', {
    title: 'Arka arkaya toplantılar',
    event_at: '2026-09-24T08:00:00Z',
  }),
  signal(SIG.deadline, 'deadline', 'due', {
    title: 'Fatura son günü',
    due_at: '2026-09-24T14:30:00Z',
    source_type: 'email_message',
    source_id: ID.mail,
  }),
  signal(SIG.conflict, 'conflict', 'overlap', {
    title: 'Takvim çakışması',
    body: 'Proje görüşmesi ile Ekip senkronu çakışıyor.',
    event_at: '2026-09-24T07:30:00Z',
  }),
  signal(SIG.extra, 'meeting', 'back_to_back', {
    title: 'Cuma arka arkaya',
    event_at: '2026-09-25T09:00:00Z',
  }),
];

const DENSITY = [
  ['2026-09-21', 120, 60, 2, false, false],
  ['2026-09-22', 0, 0, 0, false, false],
  ['2026-09-23', 330, 30, 6, true, false],
  ['2026-09-24', 90, 60, 3, false, true],
  ['2026-09-25', 60, 0, 1, false, false],
  ['2026-09-26', 0, 0, 0, false, false],
  ['2026-09-27', 0, 0, 0, false, false],
].map(([local_date, meeting_minutes, focus_minutes, event_count, is_hot, is_today]) => ({
  local_date,
  meeting_minutes,
  focus_minutes,
  event_count,
  is_hot,
  is_today,
}));

function inRange(args: Record<string, unknown>) {
  const from = Date.parse(String(args.p_from));
  const to = Date.parse(String(args.p_to));
  return {
    items: ITEMS.filter((i) => {
      if (i.start_at === null) return true;
      const at = Date.parse(i.start_at);
      return at >= from && at < to;
    }),
  };
}

const proposalApproval = approvalView({
  id: ID.approval,
  idempotency_key: `approval:${ID.approval}:v1`,
  action_type: 'calendar_create',
  type_label_key: 'approvals.types.calendar_create',
  origin: 'plan_proposal',
  side_effects: [],
  destination: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'ahmet@example.com',
    container_label: 'İş',
  },
});

const proposalOk: Responder = () =>
  json(
    201,
    ok({
      insight_id: SIG.suggestion,
      slot: { start: '2026-09-24T08:30:00Z', end: '2026-09-24T10:30:00Z' },
      alternatives: [],
      rationale_text: 'Bu aralıkta boşsun.',
      approval: proposalApproval,
    }),
  );

interface Options {
  readonly pro?: boolean;
  readonly items?: boolean;
  readonly failing?: boolean;
  readonly api?: Readonly<Record<string, Responder>>;
  readonly accounts?: readonly (typeof googleAccount)[];
}

function planSetup(options: Options = {}) {
  return setup({
    pro: options.pro ?? false,
    ...(options.accounts === undefined ? {} : { bootstrap: { accounts: [...options.accounts] } }),
    data: {
      rpc: {
        plan_range: (args) => (options.items === false ? { items: [] } : inRange(args)),
        plan_week_density: () => DENSITY,
        set_insight_status: () => null,
        get_explanation: () => ({
          reason_text: 'Takvimindeki iki etkinlik aynı saatte.',
          decision_tier: 'deterministic_signal',
          confidence: 0.95,
          sources: [],
        }),
      },
      tables: { insights: SIGNALS },
      ...(options.failing === true ? { failures: { plan_range: 'FORBIDDEN' } } : {}),
    },
    api: { 'POST /plan/proposals': proposalOk, ...options.api },
  });
}

function proposalCalls(calls: readonly { url: string; body: unknown }[]) {
  return calls.filter((c) => c.url.endsWith('/plan/proposals'));
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-PLAN-01 · Plan · Gün (populated)', () => {
  it('merges the timeline, marks overlaps, shows gaps, the all-day strip and the now line', async () => {
    planSetup();
    const { router } = await renderApp('/plan');
    const timeline = await screen.findByTestId('plan.timeline');
    expect(within(timeline).getByTestId(`plan.item.event.${ID.meeting}`)).toBeOnTheScreen();
    expect(within(timeline).getByTestId('plan.now')).toBeOnTheScreen();
    // The second meeting overlaps the first: its label says so (never colour alone).
    expect(
      within(timeline).getByTestId(`plan.item.event.${ID.online}`).props.accessibilityLabel,
    ).toMatch(/Ekip senkronu.*Çevrim içi.*Dijital Asistan ekledi.*Çakışma var/);
    // Pending and failed proposals are dashed "Önerilen" blocks; a failed one offers a retry.
    expect(within(timeline).getByTestId(`plan.proposal.${ID.proposal}`)).toBeOnTheScreen();
    expect(within(timeline).getByText('Onay bekliyor')).toBeOnTheScreen();
    expect(within(timeline).getByText('Takvime eklenemedi.')).toBeOnTheScreen();
    // Gaps ≥ 60 min inside working hours (11:30–14:00 is long enough for focus).
    expect(within(timeline).getAllByTestId('ui.gapBlock').length).toBeGreaterThanOrEqual(2);
    expect(within(timeline).getAllByText('Odak için uygun')).toHaveLength(2);
    expect(screen.getByText('Şirket tatili')).toBeOnTheScreen();
    expect(screen.getByText('Vergi beyannamesi')).toBeOnTheScreen();
    // TAKVİM ZEKÂSI: the conflict wins the day card.
    const intel = screen.getByTestId('plan.intel');
    expect(within(intel).getByText('Takvim çakışması')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('plan_viewed')[0]?.props).toEqual({ view: 'day', relative_day: 0 });
    });

    await fireEvent.press(within(intel).getByTestId('ui.cardAction.options'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/conflict/${SIG.conflict}`);
    });
    expect(events('calendar_insight_action').at(-1)?.props).toEqual({
      signal: 'conflict',
      action: 'resolve',
    });
  });

  it('opens each timeline item in its own screen (Free meeting → event detail)', async () => {
    planSetup();
    const { router } = await renderApp('/plan');
    await screen.findByTestId('plan.timeline');
    const cases: [string, string][] = [
      [`plan.item.event.${ID.meeting}`, `/event/${ID.meeting}`],
      [`plan.item.life_event.${ID.life}`, `/life/${ID.life}`],
      [`plan.item.commitment.${ID.commitment}`, `/commitments/${ID.commitment}`],
      [`plan.item.deadline.${ID.deadline}`, `/mail/${ID.mail}`],
      [`plan.proposal.${ID.proposal}`, `/plan/proposal/${ID.proposal}`],
    ];
    for (const [testID, path] of cases) {
      await fireEvent.press(await screen.findByTestId(testID));
      await waitFor(() => {
        expect(router.getPathname()).toBe(path);
      });
      await back();
    }
    expect(events('plan_item_opened').map((e) => e.props.item_type)).toEqual([
      'event',
      'event',
      'commitment',
      'event',
      'proposal',
    ]);
  });

  it('sends a Pro meeting to its prep and retries a failed proposal through its sheet', async () => {
    planSetup({ pro: true });
    const { router } = await renderApp('/plan');
    await fireEvent.press(await screen.findByTestId(`plan.item.event.${ID.meeting}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${ID.meeting}/prep`);
    });
    await back();
    await fireEvent.press(await screen.findByText('Tekrar Dene'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${ID.failed}`);
    });
  });

  it('shows the Pro gate instead of a proposal for a Free user (gap sheet M-PLAN-05)', async () => {
    const { api } = planSetup();
    await renderApp('/plan');
    const timeline = await screen.findByTestId('plan.timeline');
    await fireEvent.press(nth(within(timeline).getAllByTestId('ui.gapBlock'), 0));
    expect(await screen.findByTestId('plan.gapSheet')).toBeOnTheScreen();
    // Tasks and commitments the user owes can be placed into the gap.
    expect(screen.getByTestId(`plan.gap.task.${ID.task}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`plan.gap.task.${ID.commitment}`)).toBeOnTheScreen();
    expect(events('plan_gap_opened').at(-1)?.props).toEqual({ minutes_bucket: '>120' });
    await fireEvent.press(screen.getByTestId('plan.gap.focus'));
    await waitFor(() => {
      expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({
        feature: 'advanced_planning',
      });
    });
    expect(screen.queryByTestId('plan.intel')).toBeNull();
    expect(proposalCalls(api.calls)).toHaveLength(0);
    expect(events('plan_gap_action').at(-1)?.props).toEqual({ action: 'focus' });
  });

  it('places a gap focus block for a Pro user (POST /plan/proposals → M-PLAN-03)', async () => {
    const { api } = planSetup({ pro: true });
    const { router } = await renderApp('/plan');
    const timeline = await screen.findByTestId('plan.timeline');
    await fireEvent.press(nth(within(timeline).getAllByTestId('ui.gapBlock'), 0));
    await fireEvent.press(await screen.findByTestId('plan.gap.focus'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${ID.approval}`);
    });
    expect(proposalCalls(api.calls)[0]?.body).toEqual({
      title: 'Odak zamanı',
      duration_minutes: 120,
      window: { from: '2026-09-24T08:30:00.000Z', to: '2026-09-24T11:00:00.000Z' },
    });
  });

  it('places a task from the gap sheet and reminds from it', async () => {
    const { api } = planSetup({ pro: true });
    await renderApp('/plan');
    const timeline = await screen.findByTestId('plan.timeline');
    await fireEvent.press(nth(within(timeline).getAllByTestId('ui.gapBlock'), 0));
    await fireEvent.press(await screen.findByTestId(`plan.gap.task.${ID.commitment}`));
    await waitFor(() => {
      expect(proposalCalls(api.calls)).toHaveLength(1);
    });
    expect(proposalCalls(api.calls)[0]?.body).toMatchObject({
      item: { type: 'commitment', id: ID.commitment },
      duration_minutes: 60,
    });
    await back();
    await fireEvent.press(
      nth(within(await screen.findByTestId('plan.timeline')).getAllByTestId('ui.gapBlock'), 1),
    );
    await fireEvent.press(await screen.findByTestId('plan.gap.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('reminder_sheet_open').at(-1)?.props).toEqual({ origin: 'plan', mode: 'remind' });
    expect(events('plan_gap_action').map((e) => e.props.action)).toEqual(['task', 'remind']);
  });

  it('opens the task sheet (M-PLAN-06) with its due date and reminder, and the no-due variant', async () => {
    planSetup();
    await renderApp('/plan');
    await fireEvent.press(await screen.findByTestId(`plan.item.task.${ID.task}`));
    const sheet = await screen.findByTestId('plan.taskSheet');
    expect(within(sheet).getByText(/^Son tarih: /)).toBeOnTheScreen();
    expect(events('task_sheet_opened').at(-1)?.props).toEqual({ provider: 'google' });
    await fireEvent.press(within(sheet).getByTestId('plan.task.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('task_sheet_action').at(-1)?.props).toEqual({ action: 'remind' });
    // The date-only task sits in TÜM GÜN and opens the same sheet without a due date.
    await fireEvent.press(await screen.findByText('Vergi beyannamesi'));
    expect(await screen.findByText('Son tarih yok')).toBeOnTheScreen();
  });

  it('explains proposal failures: Pro required, no free slot and a server error', async () => {
    const answers = [
      json(402, errorBody('ENTITLEMENT_REQUIRED')),
      json(409, errorBody('STATE_CONFLICT')),
      json(500, errorBody('INTERNAL_ERROR')),
    ];
    const { api } = planSetup({
      pro: true,
      api: { 'POST /plan/proposals': () => answers.shift() ?? json(500, errorBody('INTERNAL')) },
    });
    await renderApp('/plan');
    const place = async () => {
      await fireEvent.press(await screen.findByTestId(`plan.item.task.${ID.task}`));
      await fireEvent.press(await screen.findByTestId('plan.task.place'));
    };
    await place();
    await waitFor(() => {
      expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({
        feature: 'advanced_planning',
      });
    });
    await place();
    expect(await screen.findByText('Uygun boş zaman bulunamadı.')).toBeOnTheScreen();
    await place();
    // Toasts queue one at a time (2.6 s each).
    expect(
      await screen.findByText('Zaman önerisi oluşturulamadı.', {}, { timeout: 6000 }),
    ).toBeOnTheScreen();
    expect(proposalCalls(api.calls)).toHaveLength(3);
    expect(proposalCalls(api.calls)[0]?.body).toMatchObject({
      item: { type: 'task', id: ID.task },
      duration_minutes: 60,
    });
  }, 20_000);

  it('keeps the conflict ("Böyle Kalsın") with set_insight_status and an undo toast', async () => {
    const { fake } = planSetup();
    await renderApp('/plan');
    const intel = await screen.findByTestId('plan.intel');
    await fireEvent.press(within(intel).getByTestId('ui.cardAction.keep'));
    expect(await screen.findByText('Tamam, böyle kalıyor.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: SIG.conflict,
        p_status: 'dismissed',
      });
    });
    expect(events('calendar_insight_action').at(-1)?.props).toEqual({
      signal: 'conflict',
      action: 'dismiss',
    });
  });

  it('pages days and weeks from the strip and returns with "Bugün"', async () => {
    planSetup();
    const { router } = await renderApp('/plan');
    await screen.findByTestId('plan.timeline');
    await fireEvent.press(screen.getByTestId('plan.day.2026-09-25'));
    // Friday has no timed items: the other-day empty state with the focus CTA.
    expect(await screen.findByText('Cuma için plan yok.')).toBeOnTheScreen();
    expect(router.getSearchParams()).toMatchObject({ date: '2026-09-25' });
    await fireEvent.press(screen.getByText('Sonraki hafta'));
    await waitFor(() => {
      expect(router.getSearchParams()).toMatchObject({ date: '2026-10-02' });
    });
    await fireEvent.press(await screen.findByTestId('ui.headerPill.neutral'));
    await waitFor(() => {
      expect(router.getSearchParams()).toMatchObject({ date: '2026-09-24' });
    });
    await fireEvent.press(screen.getByText('Önceki hafta'));
    await waitFor(() => {
      expect(router.getSearchParams()).toMatchObject({ date: '2026-09-17' });
    });
    expect(events('plan_date_changed').map((e) => e.props.method)).toEqual([
      'strip_tap',
      'swipe',
      'today_button',
      'swipe',
    ]);
  });

  it('proposes a 90-minute focus block from the empty day (Pro)', async () => {
    const { api } = planSetup({ pro: true, items: false });
    const { router } = await renderApp('/plan');
    const empty = await screen.findByTestId('plan.empty');
    expect(within(empty).getByText('Bugün takvimin oldukça sakin.')).toBeOnTheScreen();
    await fireEvent.press(within(empty).getByText('Odak bloğu öner'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${ID.approval}`);
    });
    expect(proposalCalls(api.calls)[0]?.body).toEqual({
      title: 'Odak zamanı',
      duration_minutes: 90,
      window: { from: '2026-09-24T06:30:00.000Z', to: '2026-09-24T15:00:00.000Z' },
    });
  });

  it('asks to connect a calendar when no account grants calendar_read', async () => {
    planSetup({
      accounts: [{ ...googleAccount, capabilities_granted: ['mail_read'] }],
    });
    const { router } = await renderApp('/plan');
    const empty = await screen.findByTestId('plan.noCalendar');
    expect(within(empty).getByText('Takvimini bağla.')).toBeOnTheScreen();
    await fireEvent.press(within(empty).getByText('Takvim Bağla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });

  it('shows the load error and recovers on retry', async () => {
    const { fake } = planSetup({ failing: true });
    await renderApp('/plan');
    const error = await screen.findByTestId('plan.error');
    fake.data.set({
      rpc: { plan_range: inRange, plan_week_density: () => DENSITY },
      tables: { insights: [] },
    });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('plan.timeline')).toBeOnTheScreen();
  });

  it('refreshes by syncing healthy accounts, and blocks gap proposals offline', async () => {
    const { api } = planSetup({
      pro: true,
      api: {
        [`POST /integrations/${googleAccount.id}/sync`]: () =>
          json(202, ok({ job_id: uuid(730), status: 'queued' })),
      },
    });
    await renderApp('/plan');
    await screen.findByTestId('plan.timeline');
    await pullToRefresh('plan.screen');
    await waitFor(() => {
      expect(events('plan_refreshed').at(-1)?.props).toEqual({ result: 'ok' });
    });
    expect(api.calls.some((c) => c.url.endsWith(`/integrations/${googleAccount.id}/sync`))).toBe(
      true,
    );

    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('m2.offlineBanner')).toBeOnTheScreen();
    await fireEvent.press(
      nth(within(screen.getByTestId('plan.timeline')).getAllByTestId('ui.gapBlock'), 0),
    );
    await fireEvent.press(await screen.findByTestId('plan.gap.focus'));
    expect(proposalCalls(api.calls)).toHaveLength(0);
  });
});

describe('M-PLAN-02 · Plan · Hafta', () => {
  it('renders the density chart and every Calendar Intelligence card by severity', async () => {
    planSetup({ pro: true });
    const { router } = await renderApp('/plan?view=week');
    const chart = await screen.findByTestId('plan.density');
    expect(chart.props.accessibilityLabel ?? '').toBeDefined();
    expect(screen.getByText('12 etkinlik')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('plan_viewed').at(-1)?.props).toEqual({ view: 'week', week_offset: 0 });
    });
    // Six cards, then "1 uyarı daha".
    expect(screen.getByTestId(`plan.week.signal.${SIG.conflict}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`plan.week.signal.${SIG.suggestion}`)).toBeNull();
    await waitFor(() => {
      expect(events('calendar_insight_shown')).toHaveLength(6);
    });
    await fireEvent.press(screen.getByText('1 uyarı daha'));
    expect(await screen.findByTestId(`plan.week.signal.${SIG.suggestion}`)).toBeOnTheScreen();

    // Deadline "Kaynağı Aç" goes to the mail it came from.
    await fireEvent.press(
      within(screen.getByTestId(`plan.week.signal.${SIG.deadline}`)).getByTestId(
        'ui.cardAction.source',
      ),
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${ID.mail}`);
    });
    await back();
    // Prep "Hazırlığı Aç" opens the meeting prep.
    await fireEvent.press(
      within(await screen.findByTestId(`plan.week.signal.${SIG.prep}`)).getByTestId(
        'ui.cardAction.open',
      ),
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${ID.meeting}/prep`);
    });
  });

  it('proposes from the suggestion and prep cards, and reminds / explains a leave-by', async () => {
    const { api } = planSetup({ pro: true });
    await renderApp('/plan?view=week');
    await fireEvent.press(await screen.findByText('1 uyarı daha'));
    const suggestion = await screen.findByTestId(`plan.week.signal.${SIG.suggestion}`);
    await fireEvent.press(within(suggestion).getByTestId('ui.cardAction.plan'));
    await waitFor(() => {
      expect(proposalCalls(api.calls)).toHaveLength(1);
    });
    expect(proposalCalls(api.calls)[0]?.body).toMatchObject({
      item: { type: 'insight', id: SIG.suggestion },
      duration_minutes: 60,
      window: { from: '2026-09-24T06:35:00.000Z', to: '2026-10-01T06:35:00.000Z' },
    });
    await back();
    await fireEvent.press(
      within(await screen.findByTestId(`plan.week.signal.${SIG.suggestion}`)).getByTestId(
        'ui.cardAction.other',
      ),
    );
    await waitFor(() => {
      expect(proposalCalls(api.calls)).toHaveLength(2);
    });
    // "Başka zaman" starts after the suggested slot.
    expect(proposalCalls(api.calls)[1]?.body).toMatchObject({
      window: { from: '2026-09-25T08:00:00.000Z' },
    });
    await back();
    await fireEvent.press(
      within(await screen.findByTestId(`plan.week.signal.${SIG.prep}`)).getByTestId(
        'ui.cardAction.place',
      ),
    );
    await waitFor(() => {
      expect(proposalCalls(api.calls)).toHaveLength(3);
    });
    expect(proposalCalls(api.calls)[2]?.body).toMatchObject({
      title: 'Hazırlık: Proje görüşmesi',
      duration_minutes: 30,
    });
    await back();
    const leave = await screen.findByTestId(`plan.week.signal.${SIG.leaveBy}`);
    expect(within(leave).getByText("15:00'e Hatırlat")).toBeOnTheScreen();
    await fireEvent.press(within(leave).getByTestId('ui.cardAction.source'));
    expect(await screen.findByText('Takvimindeki iki etkinlik aynı saatte.')).toBeOnTheScreen();
    await fireEvent.press(within(leave).getByTestId('ui.cardAction.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('calendar_insight_action').map((e) => e.props.action)).toEqual([
      'propose',
      'propose',
      'place_prep',
      'open',
    ]);
  });

  it('pages weeks, opens a day from the chart and gates Free proposals', async () => {
    const { api } = planSetup();
    const { router } = await renderApp('/plan?view=week');
    await screen.findByTestId('plan.density');
    await fireEvent.press(screen.getByLabelText('Sonraki hafta'));
    await waitFor(() => {
      expect(events('plan_week_paged').at(-1)?.props).toEqual({ direction: 'next' });
    });
    await fireEvent.press(await screen.findByLabelText('Önceki hafta'));
    await waitFor(() => {
      expect(router.getSearchParams()).toMatchObject({ date: '2026-09-24' });
    });
    await fireEvent.press(await screen.findByText('1 uyarı daha'));
    await fireEvent.press(
      within(await screen.findByTestId(`plan.week.signal.${SIG.suggestion}`)).getByTestId(
        'ui.cardAction.plan',
      ),
    );
    await waitFor(() => {
      expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({
        feature: 'advanced_planning',
      });
    });
    expect(proposalCalls(api.calls)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('ui.weekDensityChart.2026-09-23'));
    await waitFor(() => {
      expect(router.getSearchParams()).toMatchObject({ view: 'day' });
    });
    expect(await screen.findByTestId('plan.strip')).toBeOnTheScreen();
  });

  it('shows the week error and the balanced week', async () => {
    const { fake } = setup({
      data: {
        rpc: { plan_range: () => ({ items: [] }) },
        failures: { plan_week_density: 'FORBIDDEN' },
      },
    });
    await renderApp('/plan?view=week');
    const error = await screen.findByTestId('plan.week.error');
    fake.data.set({
      rpc: {
        plan_week_density: () => DENSITY.map((d) => ({ ...d, event_count: 0, meeting_minutes: 0 })),
      },
    });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('plan.week.balanced')).toBeOnTheScreen();
    expect(screen.getAllByText('Bu hafta toplantı yok.').length).toBeGreaterThan(0);
  });
});
