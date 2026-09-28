/**
 * T-8.10 · Akış with every card variant (SCREEN_AND_FLOW_MAP M-FLOW-01 "Primary CTA" table): the
 * one primary action per card type and plan (reply → AI reply, deadline → "Takvime Ekle" through
 * `POST /approvals` and the approval sheet, meeting → event / prep, follow-up → `POST /followups/
 * :threadId/draft`, commitment → `POST /plan/proposals`, life cards → their detail), the card tap
 * targets, the "···" menu mirroring every swipe verb (done / snooze sheet / not important / show
 * more / why), the swipe verbs as accessibility actions, the header states (meta line, reconnect,
 * sync delayed, partial refresh failure, digest row), pull-to-refresh, paging, the Takip Pro gate
 * and the per-filter empty states.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type Responder } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import type { DataRoutes } from '../helpers/supabase-data';
import { events, setup } from '../m2/harness';
import { back, pullToRefresh, sequence } from './support';

// 09:30 in Istanbul on Thursday 24 September 2026.
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const MSG = uuid(900);
const THREAD = uuid(901);
const EVENT = uuid(902);
const COMMITMENT = uuid(903);
const LIFE = uuid(904);
const CAPTURE = uuid(905);
const APPROVAL = uuid(906);
const DRAFT = uuid(907);

const C = {
  reply: uuid(910),
  deadlineMail: uuid(911),
  fyi: uuid(912),
  meeting: uuid(913),
  deadlineCal: uuid(914),
  deadlineDoc: uuid(915),
  followUp: uuid(916),
  commitment: uuid(917),
  security: uuid(918),
  paymentDue: uuid(919),
  payment: uuid(920),
  shipment: uuid(921),
} as const;

function card(id: string, cardType: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    card_type: cardType,
    kind: 'info',
    urgency: 'normal',
    title: `${cardType} ${id.slice(-3)}`,
    body: 'Özet metni.',
    why_important: null,
    decision_tier: null,
    reason_code: null,
    entity_type: null,
    entity_id: null,
    due_at: null,
    event_at: null,
    created_at: TS,
    source: {
      source_type: 'email_message',
      source_id: MSG,
      provider: 'google',
      source_timestamp: '2026-09-24T05:40:00Z',
    },
    ...overrides,
  };
}

const CARDS = [
  card(C.reply, 'email', {
    kind: 'reply_needed',
    urgency: 'urgent',
    title: 'Teklif yanıtı bekleniyor',
    entity_type: 'email_message',
    entity_id: MSG,
  }),
  card(C.deadlineMail, 'email', {
    kind: 'deadline',
    urgency: 'today',
    title: 'Sözleşme son günü',
    due_at: '2026-09-25T12:00:00Z',
    entity_type: 'email_thread',
    entity_id: THREAD,
  }),
  card(C.fyi, 'email', {
    title: 'Bülten',
    body: null,
    entity_type: 'email_thread',
    entity_id: THREAD,
  }),
  card(C.meeting, 'meeting', {
    title: 'Müşteri toplantısı',
    event_at: '2026-09-24T11:00:00Z',
    entity_type: 'calendar_event',
    entity_id: EVENT,
    source: {
      source_type: 'calendar_event',
      source_id: EVENT,
      provider: 'microsoft',
      source_timestamp: TS,
    },
  }),
  card(C.deadlineCal, 'deadline', {
    title: 'Proje teslimi',
    due_at: '2026-09-26T09:00:00Z',
    source: {
      source_type: 'calendar_event',
      source_id: EVENT,
      provider: 'apple_device',
      source_timestamp: TS,
    },
  }),
  card(C.deadlineDoc, 'deadline', {
    title: 'Vergi beyannamesi',
    due_at: '2026-09-30T09:00:00Z',
    entity_type: 'capture',
    entity_id: CAPTURE,
    source: { source_type: 'capture', source_id: CAPTURE, provider: null, source_timestamp: TS },
  }),
  card(C.followUp, 'follow_up', {
    title: 'Mehmet yanıt vermedi',
    entity_type: 'email_thread',
    entity_id: THREAD,
  }),
  card(C.commitment, 'commitment', {
    title: 'Sözün: Teklifi gönder',
    due_at: '2026-09-26T15:00:00Z',
    entity_type: 'commitment',
    entity_id: COMMITMENT,
  }),
  card(C.security, 'security', {
    title: 'Yeni cihazdan giriş',
    entity_type: 'life_event',
    entity_id: LIFE,
  }),
  card(C.paymentDue, 'payment', {
    title: 'Elektrik faturası',
    due_at: '2026-09-28T09:00:00Z',
    entity_type: 'life_event',
    entity_id: LIFE,
  }),
  card(C.payment, 'payment', {
    title: 'Kira ödemesi',
    source: { ...card('', '').source, source_id: null },
  }),
  card(C.shipment, 'shipment', {
    title: 'Kargon yolda',
    entity_type: 'life_event',
    entity_id: LIFE,
  }),
];

const META = {
  total: 12,
  important: 3,
  last_analysis_at: '2026-09-24T06:00:00Z',
  accounts: [
    {
      id: googleAccount.id,
      provider: 'google',
      status: 'healthy',
      last_success_at: '2026-09-24T05:00:00Z',
    },
    { id: uuid(11), provider: 'microsoft', status: 'needs_reauth', last_success_at: null },
  ],
};

function page(items: readonly unknown[], next: string | null = null, meta = META) {
  return { items, next_cursor: next, meta };
}

const draft = {
  id: DRAFT,
  kind: 'follow_up',
  email_message_id: MSG,
  email_thread_id: THREAD,
  connected_account_id: googleAccount.id,
  tone: 'short',
  subject: 'Re: Teklif',
  to: [{ email: 'mehmet@yilmaz.example', name: 'Mehmet' }],
  cc: [],
  body_text: 'Merhaba, teklif hakkında dönüşünüzü bekliyorum.',
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

const calendarApproval = approvalView({
  id: APPROVAL,
  idempotency_key: `approval:${APPROVAL}:v1`,
  action_type: 'calendar_create',
  type_label_key: 'approvals.types.calendar_create',
  origin: 'insight',
  side_effects: [],
  destination: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'ahmet@example.com',
    container_label: 'İş',
  },
});

interface Options {
  readonly pro?: boolean;
  readonly items?: readonly unknown[];
  readonly api?: Readonly<Record<string, Responder>>;
  readonly data?: DataRoutes;
}

function flowSetup(options: Options = {}) {
  const items = options.items ?? CARDS;
  return setup({
    pro: options.pro ?? false,
    data: {
      rpc: {
        flow_feed: () => page(items),
        mail_intelligence: () => ({
          total: 18,
          attention: 4,
          counts: {},
          rows: [],
          next_cursor: null,
        }),
        set_insight_status: () => null,
        apply_insight_feedback: () => ({ feedback_id: uuid(930) }),
        get_explanation: () => ({
          reason_text: 'Mehmet Bey iki kez sordu.',
          decision_tier: 'ai_classification',
          confidence: 0.62,
          sources: [
            {
              source_type: 'email_message',
              provider: 'google',
              account_label: 'ahmet@example.com',
              display: 'Mehmet Yılmaz',
              source_timestamp: TS,
              evidence: [{ quote: 'Teklifi yarına kadar bekliyorum.' }],
              in_app_deeplink: `dijitalasistan://mail/${MSG}`,
            },
          ],
        }),
      },
      tables: {
        email_messages: [{ id: MSG, thread_id: THREAD, direction: 'inbound', received_at: TS }],
        calendars: [
          { id: uuid(12), connected_account_id: googleAccount.id, can_write: true, selected: true },
        ],
      },
      ...options.data,
    },
    api: {
      'POST /approvals': () => json(201, ok(calendarApproval)),
      [`POST /followups/${THREAD}/draft`]: () => json(201, ok(draft)),
      'POST /plan/proposals': () =>
        json(
          201,
          ok({
            insight_id: C.commitment,
            slot: { start: '2026-09-25T08:00:00Z', end: '2026-09-25T09:00:00Z' },
            alternatives: [],
            rationale_text: 'Boş zaman.',
            approval: calendarApproval,
          }),
        ),
      ...options.api,
    },
  });
}

/** Only the first screenful of a FlashList renders in tests: pick the cards a test needs. */
function only(...ids: string[]) {
  return CARDS.filter((c) => ids.includes(c.id));
}

function row(id: string) {
  return screen.getByTestId(`flow.row.${id}`);
}

async function pressPrimary(id: string) {
  await fireEvent.press(
    within(await screen.findByTestId(`flow.row.${id}`)).getByTestId('ui.cardAction.primary'),
  );
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-FLOW-01 · card primary actions', () => {
  it('reply opens the AI reply; a Free meeting opens the event; follow-up drafts a message', async () => {
    const { api } = flowSetup();
    const { router } = await renderApp('/flow');
    expect(await screen.findByText('Teklif yanıtı bekleniyor')).toBeOnTheScreen();
    // No summary → "Özet hazırlanamadı".
    expect(within(row(C.fyi)).getByText('Özet hazırlanamadı')).toBeOnTheScreen();
    expect(within(row(C.reply)).getByText('Yanıt Hazırla')).toBeOnTheScreen();
    await pressPrimary(C.reply);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({ mode: 'reply', origin: 'flow' });
    await back();

    expect(within(row(C.meeting)).getByText('Etkinliği Aç')).toBeOnTheScreen();
    await pressPrimary(C.meeting);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/event/${EVENT}`);
    });
    await back();

    await pressPrimary(C.followUp);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({
      mode: 'follow_up',
      draftId: DRAFT,
      origin: 'flow',
    });
    expect(api.calls.find((c) => c.url.endsWith(`/followups/${THREAD}/draft`))?.body).toEqual({
      tone: 'short',
    });
    expect(events('follow_up_draft_created').at(-1)?.props).toEqual({
      tone: 'short',
      result: 'ok',
    });
    expect(events('flow_card_action').map((e) => e.props.action)).toEqual([
      'reply',
      'open',
      'followup_draft',
    ]);
  });

  it('"Takvime Ekle" proposes a 30-minute block before the deadline and opens the approval sheet', async () => {
    const { api } = flowSetup();
    await renderApp('/flow');
    await pressPrimary(C.deadlineMail);
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
    const body = api.calls.find((c) => c.url.endsWith('/approvals'))?.body as {
      payload: Record<string, unknown>;
      origin: string;
      origin_ref_id: string;
    };
    expect(body.payload).toMatchObject({
      action_type: 'calendar_create',
      target: { kind: 'provider', connected_account_id: googleAccount.id, calendar_id: uuid(12) },
      title: 'Sözleşme son günü',
      time: {
        kind: 'timed',
        start: '2026-09-25T11:30:00.000Z',
        end: '2026-09-25T12:00:00.000Z',
        time_zone: 'Europe/Istanbul',
      },
      origin_task_ref: { type: 'insight', id: C.deadlineMail },
    });
    expect(body.origin).toBe('insight');
    expect(body.origin_ref_id).toBe(C.deadlineMail);
  });

  it('explains proposal failures: already pending, Pro-only, source off and no calendar', async () => {
    flowSetup({
      api: {
        'POST /approvals': sequence(
          json(409, {
            error: { ...errorBody('STATE_CONFLICT').error, details: { approval_id: APPROVAL } },
          }),
          json(402, errorBody('ENTITLEMENT_REQUIRED')),
        ),
      },
    });
    const { router } = await renderApp('/flow');
    await pressPrimary(C.deadlineMail);
    expect(await screen.findByText('Bu işlem zaten onayını bekliyor.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Görüntüle'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/approvals/${APPROVAL}`);
    });
    await back();
    await pressPrimary(C.deadlineMail);
    expect(
      await screen.findByText("Bu işlem Pro'da kullanılabilir.", {}, { timeout: 6000 }),
    ).toBeOnTheScreen();
  }, 20_000);

  it('says so when no writable calendar exists', async () => {
    flowSetup({ data: { tables: { calendars: [] } } });
    await renderApp('/flow');
    await pressPrimary(C.deadlineMail);
    expect(await screen.findByText('Yazılabilir bir takvim bulunamadı.')).toBeOnTheScreen();
  });

  it('plans a commitment (POST /plan/proposals) and explains a missing slot', async () => {
    const { api } = flowSetup({
      pro: true,
      api: {
        'POST /plan/proposals': sequence(
          json(409, errorBody('STATE_CONFLICT')),
          json(
            201,
            ok({
              insight_id: C.commitment,
              slot: { start: '2026-09-25T08:00:00Z', end: '2026-09-25T09:00:00Z' },
              alternatives: [],
              rationale_text: 'Boş zaman.',
              approval: calendarApproval,
            }),
          ),
        ),
      },
    });
    const { router } = await renderApp('/flow');
    expect(
      within(await screen.findByTestId(`flow.row.${C.commitment}`)).getByText('Planla'),
    ).toBeOnTheScreen();
    await pressPrimary(C.commitment);
    expect(await screen.findByText('Bu aralıkta boş zaman bulamadım.')).toBeOnTheScreen();
    await pressPrimary(C.commitment);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${APPROVAL}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/plan/proposals'))?.body).toEqual({
      item: { type: 'commitment', id: COMMITMENT },
      duration_minutes: 60,
      window: { from: '2026-09-24T06:35:00.000Z', to: '2026-09-26T15:00:00.000Z' },
    });
  });

  it('a Pro meeting prepares; deadlines from a calendar remind; life cards open their detail', async () => {
    flowSetup({
      pro: true,
      items: only(C.meeting, C.deadlineCal, C.paymentDue, C.security, C.shipment, C.payment),
    });
    const { router } = await renderApp('/flow');
    expect(
      within(await screen.findByTestId(`flow.row.${C.meeting}`)).getByText('Hazırlan'),
    ).toBeOnTheScreen();
    await pressPrimary(C.meeting);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/prep`);
    });
    await back();
    await pressPrimary(C.deadlineCal);
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('reminder_sheet_open').at(-1)?.props).toEqual({
      origin: 'deadline',
      mode: 'remind',
    });
    await pressPrimary(C.paymentDue);
    await waitFor(() => {
      expect(events('reminder_sheet_open').at(-1)?.props).toEqual({
        origin: 'life_event',
        mode: 'remind',
      });
    });
    for (const id of [C.security, C.shipment]) {
      await pressPrimary(id);
      await waitFor(() => {
        expect(router.getPathname()).toBe(`/life/${LIFE}`);
      });
      await back();
    }
    // A life card without an entity explains its source instead.
    await pressPrimary(C.payment);
    expect(await screen.findByTestId('m2.source')).toBeOnTheScreen();
  });

  it('opens each card body in its screen (mail thread → latest inbound, capture, follow-ups)', async () => {
    flowSetup({ pro: true });
    const { router } = await renderApp('/flow');
    const cases: [string, string, string][] = [
      [C.fyi, 'email', `/mail/${MSG}`],
      [C.deadlineCal, 'deadline', `/event/${EVENT}`],
      [C.deadlineDoc, 'deadline', `/capture/${CAPTURE}`],
      [C.followUp, 'follow_up', '/followups'],
      [C.commitment, 'commitment', `/commitments/${COMMITMENT}`],
    ];
    for (const [id, type, path] of cases) {
      await fireEvent.press(
        within(await screen.findByTestId(`flow.row.${id}`)).getByTestId(`flow.card.${type}`),
      );
      await waitFor(() => {
        expect(router.getPathname()).toBe(path);
      });
      await back();
    }
    expect(events('flow_card_open').map((e) => e.props.card_type)).toEqual([
      'email',
      'deadline',
      'deadline',
      'follow_up',
      'commitment',
    ]);
  });
});

describe('M-FLOW-01 · menu, swipe verbs and sheets', () => {
  it('completes, snoozes and teaches from the "···" menu with undo', async () => {
    const { fake } = flowSetup({ items: only(C.reply, C.fyi, C.shipment) });
    await renderApp('/flow');
    const more = async (id: string) => {
      await fireEvent.press(
        within(await screen.findByTestId(`flow.row.${id}`)).getByLabelText('Diğer seçenekler'),
      );
    };
    await more(C.reply);
    await fireEvent.press(await screen.findByTestId('m2.menu.done'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: C.reply,
        p_status: 'done',
      });
    });
    expect(events('insight_status_change').at(-1)?.props).toEqual({
      from: 'open',
      to: 'done',
      via: 'button',
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(
        fake.data.calls.filter((c) => c.target === 'set_insight_status').at(-1)?.args,
      ).toMatchObject({ p_insight_id: C.reply, p_status: 'open' });
    });

    await more(C.fyi);
    await fireEvent.press(await screen.findByTestId('m2.menu.show_more'));
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({ p_insight_id: C.fyi, p_kind: 'show_more' });
    });
    expect(screen.getByTestId(`flow.row.${C.fyi}`)).toBeOnTheScreen();

    await more(C.shipment);
    await fireEvent.press(await screen.findByTestId('m2.menu.snooze'));
    expect(await screen.findByTestId('m2.snooze')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('m2.snooze.evening'));
    await waitFor(() => {
      expect(
        fake.data.calls.filter((c) => c.target === 'set_insight_status').at(-1)?.args,
      ).toMatchObject({ p_insight_id: C.shipment, p_status: 'snoozed' });
    });
    expect(
      await screen.findByText(/^Ertelendi · Bu akşam · /, {}, { timeout: 8000 }),
    ).toBeOnTheScreen();
  }, 20_000);

  it('explains a card ("Bu nereden çıktı?") and opens the source mail from the sheet', async () => {
    flowSetup();
    const { router } = await renderApp('/flow');
    await fireEvent.press(
      within(await screen.findByTestId(`flow.row.${C.reply}`)).getByLabelText('Diğer seçenekler'),
    );
    await fireEvent.press(await screen.findByTestId('m2.menu.why'));
    const sheet = await screen.findByTestId('m2.source');
    expect(await within(sheet).findByText('Mehmet Bey iki kez sordu.')).toBeOnTheScreen();
    expect(within(sheet).getByText(/Teklifi yarına kadar bekliyorum/)).toBeOnTheScreen();
    expect(events('source_sheet_open').at(-1)?.props).toEqual({
      origin: 'flow',
      target_type: 'insight',
    });
    await fireEvent.press(within(sheet).getByText('Kaynağı Aç'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}`);
    });
  });

  it('runs the swipe verbs from the card accessibility actions', async () => {
    const { fake } = flowSetup({ items: only(C.payment, C.security, C.shipment, C.fyi) });
    await renderApp('/flow');
    const verb = async (id: string, type: string, actionName: string) => {
      const target = within(await screen.findByTestId(`flow.row.${id}`)).getByTestId(
        `flow.card.${type}`,
      );
      await fireEvent(target, 'accessibilityAction', { nativeEvent: { actionName } });
    };
    await verb(C.payment, 'payment', 'dismiss');
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({
        p_insight_id: C.payment,
        p_kind: 'not_important',
      });
    });
    expect(events('flow_swipe').at(-1)?.props).toEqual({
      direction: 'left',
      action: 'not_important',
      card_type: 'payment',
    });
    await verb(C.security, 'security', 'dismiss');
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: C.security,
        p_status: 'dismissed',
      });
    });
    await verb(C.shipment, 'shipment', 'complete');
    expect(events('flow_swipe').at(-1)?.props).toEqual({
      direction: 'right',
      action: 'done',
      card_type: 'shipment',
    });
    await verb(C.fyi, 'email', 'snooze');
    expect(await screen.findByTestId('m2.snooze')).toBeOnTheScreen();
    await verb(C.fyi, 'email', 'why');
    expect(await screen.findByTestId('m2.source')).toBeOnTheScreen();
  });
});

describe('M-FLOW-01 · header, refresh and states', () => {
  it('shows the meta line, reconnect and sync-delayed cards and the digest row', async () => {
    flowSetup({
      data: {
        rpc: { flow_feed: () => page(CARDS.slice(0, 2)) },
      },
    });
    const { router } = await renderApp('/flow');
    const meta = await screen.findByTestId('flow.meta');
    expect(within(meta).getByText(/12 konu/)).toBeOnTheScreen();
    expect(screen.getByText(/Outlook/)).toBeOnTheScreen();
    expect(screen.getByTestId('flow.syncDelayed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Sonra'));
    await fireEvent.press(within(screen.getByTestId('flow.syncDelayed')).getByText('Tamam'));
    await waitFor(() => {
      expect(screen.queryByTestId('flow.syncDelayed')).toBeNull();
    });
    await fireEvent.press(await screen.findByTestId('flow.digest'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/mail');
    });
  });

  it('refreshes by syncing healthy accounts; offline it says it is still offline', async () => {
    const { api } = flowSetup({
      api: {
        [`POST /integrations/${googleAccount.id}/sync`]: () =>
          json(202, ok({ job_id: uuid(931), status: 'queued' })),
      },
    });
    await renderApp('/flow');
    await screen.findByTestId(`flow.row.${C.reply}`);
    const refresh = () => pullToRefresh('flow.list');
    await refresh();
    await waitFor(() => {
      expect(events('flow_refresh').at(-1)?.props).toEqual({ result: 'ok' });
    });
    expect(api.calls.filter((c) => c.url.includes('/sync'))).toHaveLength(1);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('m2.offlineBanner')).toBeOnTheScreen();
    await refresh();
    await waitFor(() => {
      expect(events('flow_refresh').at(-1)?.props).toEqual({ result: 'offline' });
    });
    // Offline, a reply is blocked before any request.
    await pressPrimary(C.reply);
    expect(events('offline_blocked_action').at(-1)?.props).toEqual({ action: 'reply' });
  });

  it('loads the next page at the end of the list', async () => {
    const { fake } = flowSetup({
      data: {
        rpc: {
          flow_feed: (args) =>
            args.p_cursor === 'c2' ? page(CARDS.slice(6, 8)) : page(CARDS.slice(0, 6), 'c2'),
        },
      },
    });
    await renderApp('/flow');
    await screen.findByTestId(`flow.row.${C.reply}`);
    const list = screen.getByTestId('flow.list');
    await act(async () => {
      (list.props as { onEndReached?: () => void }).onEndReached?.();
      await Promise.resolve();
    });
    expect(await screen.findByTestId(`flow.row.${C.commitment}`)).toBeOnTheScreen();
    expect(
      fake.data.calls
        .filter((c) => c.target === 'flow_feed')
        .map((c) => (c.args as { p_cursor?: string }).p_cursor),
    ).toContain('c2');
  });

  it('shows the error state without data and a refresh-failed card with data', async () => {
    let fail = true;
    const { fake } = flowSetup({ data: { failures: { flow_feed: 'FORBIDDEN' } } });
    await renderApp('/flow');
    const error = await screen.findByTestId('flow.error');
    fake.data.set({ rpc: { flow_feed: () => (fail ? page(CARDS.slice(0, 1)) : page([])) } });
    fail = false;
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('flow.empty.all')).toBeOnTheScreen();
  });

  it('gates the Takip filter for Free users with the open follow-up count', async () => {
    const { fake } = setup({
      bootstrap: {
        counts: { pending_approvals: 0, open_followups: 3, open_commitments: 0 },
      },
    });
    await renderApp('/flow?filter=followup');
    expect(await screen.findByText('3 gönderdiğin mail yanıtsız.')).toBeOnTheScreen();
    expect(screen.getByText('TAKİP · PRO')).toBeOnTheScreen();
    expect(fake.data.calls.some((c) => c.target === 'flow_feed')).toBe(false);
  });

  it('shows each filter’s own empty state', async () => {
    flowSetup({ pro: true, items: [] });
    const { router } = await renderApp('/flow');
    expect(await screen.findByTestId('flow.empty.all')).toBeOnTheScreen();
    for (const [filter, testID] of [
      ['important', 'flow.empty.important'],
      ['mail', 'flow.empty.mail'],
      ['calendar', 'flow.empty.calendar'],
      ['followup', 'flow.empty.followup'],
      ['personal', 'flow.empty.personal'],
    ] as const) {
      await fireEvent.press(screen.getByTestId(`ui.filterChip.${filter}`));
      expect(await screen.findByTestId(testID)).toBeOnTheScreen();
    }
    expect(screen.getByText('Kişisel sinyal yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ui.filterChip.mail'));
    expect(await screen.findByText('Bugün 18 maili senin için okudum.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Mail Zekâsı'nı Aç"));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/mail');
    });
    expect(events('flow_filter_select').map((e) => e.props.filter)).toEqual([
      'important',
      'mail',
      'calendar',
      'followup',
      'personal',
      'mail',
    ]);
  });

  it('asks to connect a calendar or an account when none is connected', async () => {
    setup({
      bootstrap: { accounts: [{ ...googleAccount, capabilities_granted: ['mail_read'] }] },
      data: { rpc: { flow_feed: () => page([], null, { ...META, accounts: [] }) } },
    });
    await renderApp('/flow?filter=calendar');
    expect(await screen.findByTestId('flow.empty.calendarNone')).toBeOnTheScreen();
  });

  it('shows the no-account empty state', async () => {
    setup({
      bootstrap: { accounts: [] },
      data: { rpc: { flow_feed: () => page([], null, { ...META, accounts: [] }) } },
    });
    const { router } = await renderApp('/flow');
    const empty = await screen.findByTestId('flow.empty.noAccount');
    await fireEvent.press(within(empty).getByText(/Bağla/));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });
});
