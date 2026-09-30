/**
 * T-8.12 · People waiting and follow-ups with populated data (SCREEN_AND_FLOW_MAP M-WAIT-01
 * Senden Beklenenler, M-FUP-01 Senin Cevap Beklediklerin): urgency groups with grounded due dates,
 * "Yanıt Hazırla" into the reply modal, the "···" menu (open mail, remind, no reply needed, source),
 * the swipe verbs, and for follow-ups the draft (`POST /followups/:threadId/draft`), "Yarın
 * hatırlat", "Kapat", "Bu kişiyi takip etme" (RPC-21 `stop_tracking`), the focus ordering and the
 * empty / error states.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type Responder } from '../helpers/app';
import { errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import type { DataRoutes } from '../helpers/supabase-data';
import { events, setup } from '../m2/harness';
import { back, sequence } from './support';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const W = { urgent: uuid(1500), today: uuid(1501), later: uuid(1502) };
const F = { old: uuid(1510), recent: uuid(1511) };
const M = { a: uuid(1520), b: uuid(1521), c: uuid(1522), d: uuid(1523), e: uuid(1524) };
const THREAD = uuid(1530);

function insight(
  id: string,
  kind: string,
  messageId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    kind,
    status: 'open',
    title: 'Konu',
    body: null,
    urgency: 'normal',
    due_at: null,
    entity_type: null,
    entity_id: null,
    source_type: 'email_message',
    source_id: messageId,
    source_provider: 'google',
    source_timestamp: TS,
    created_at: TS,
    ...overrides,
  };
}

function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    thread_id: THREAD,
    from_name: 'Mehmet Yılmaz',
    from_email: 'mehmet@yilmaz.example',
    to_emails: ['ayse@demir.example'],
    subject: 'Teklif revizyonu',
    received_at: '2026-09-23T08:00:00Z',
    provider: 'google',
    ...overrides,
  };
}

const TABLES = {
  insights: [
    insight(W.urgent, 'reply_needed', M.a, {
      urgency: 'urgent',
      due_at: '2026-09-24T12:00:00Z',
      body: 'Fiyat onayı bekleniyor.',
    }),
    insight(W.today, 'reply_needed', M.b, { urgency: 'today', due_at: '2026-09-26T12:00:00Z' }),
    insight(W.later, 'reply_needed', M.c, { urgency: 'low' }),
    insight(F.old, 'follow_up', M.d, {
      entity_type: 'email_thread',
      entity_id: THREAD,
      body: 'Henüz yanıt yok, iki kez yazdın.',
    }),
    insight(F.recent, 'follow_up', M.e),
  ],
  email_messages: [
    message(M.a),
    message(M.b, {
      from_name: null,
      from_email: 'kerem@kaya.example',
      subject: 'Toplantı saati',
      received_at: '2026-09-24T05:00:00Z',
    }),
    message(M.c, { from_name: 'Selin', subject: 'Bülten', received_at: '2026-09-10T08:00:00Z' }),
    message(M.d, {
      to_emails: ['ayse@demir.example'],
      subject: 'Sözleşme',
      received_at: '2026-09-14T08:00:00Z',
      provider: 'microsoft',
    }),
    message(M.e, {
      to_emails: ['kerem@kaya.example'],
      subject: 'Sunum',
      received_at: '2026-09-22T08:00:00Z',
    }),
  ],
};

function peopleSetup(
  options: {
    readonly pro?: boolean;
    readonly data?: DataRoutes;
    readonly api?: Readonly<Record<string, Responder>>;
  } = {},
) {
  return setup({
    pro: options.pro ?? true,
    data: options.data ?? {
      rpc: {
        set_insight_status: () => null,
        apply_insight_feedback: () => ({ feedback_id: uuid(1540) }),
      },
      tables: TABLES,
    },
    ...(options.api === undefined ? {} : { api: options.api }),
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-WAIT-01 · Senden Beklenenler', () => {
  it('groups people by urgency with grounded due dates and opens the reply', async () => {
    peopleSetup();
    const { router } = await renderApp('/waiting');
    expect(await screen.findByTestId('waiting.group.urgent')).toBeOnTheScreen();
    expect(screen.getByTestId('waiting.group.today')).toBeOnTheScreen();
    expect(screen.getByTestId('waiting.group.later')).toBeOnTheScreen();
    expect(screen.getByText('3 kişi senden cevap bekliyor')).toBeOnTheScreen();
    const urgent = screen.getByTestId(`waiting.card.${W.urgent}`);
    expect(within(urgent).getByText('Fiyat onayı bekleniyor.')).toBeOnTheScreen();
    expect(within(urgent).getByText('Beklenen: Bugün 15:00')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`waiting.card.${W.today}`)).getByText('kerem@kaya.example'),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('waiting_view')[0]?.props).toEqual({ count_bucket: '2-5' });
    });
    await fireEvent.press(within(urgent).getByText('Yanıt Hazırla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${M.a}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({ mode: 'reply', origin: 'waiting' });
    await back();
    await fireEvent.press(await screen.findByTestId(`waiting.card.${W.later}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${M.c}`);
    });
  });

  it('runs the "···" menu: remind, no reply needed and source', async () => {
    const { fake } = peopleSetup();
    await renderApp('/waiting');
    const more = async (id: string) => {
      await fireEvent.press(
        within(await screen.findByTestId(`waiting.card.${id}`)).getByLabelText('Diğer seçenekler'),
      );
    };
    await more(W.urgent);
    await fireEvent.press(await screen.findByTestId('m2.menu.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    await more(W.today);
    await fireEvent.press(await screen.findByTestId('m2.menu.noReply'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: W.today,
        p_status: 'done',
      });
    });
    expect(await screen.findByText('Cevaplandı olarak işaretlendi.')).toBeOnTheScreen();
    await more(W.later);
    await fireEvent.press(await screen.findByTestId('m2.menu.why'));
    expect(await screen.findByTestId('m2.source')).toBeOnTheScreen();
    expect(events('waiting_action').map((e) => e.props.action)).toEqual(['remind', 'done']);
  });

  it('runs the swipe verbs as accessibility actions', async () => {
    const { fake } = peopleSetup();
    await renderApp('/waiting');
    const verb = async (id: string, actionName: string) => {
      await fireEvent(await screen.findByTestId(`waiting.card.${id}`), 'accessibilityAction', {
        nativeEvent: { actionName },
      });
    };
    await verb(W.later, 'dismiss');
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({
        p_insight_id: W.later,
        p_kind: 'not_important',
      });
    });
    await verb(W.today, 'snooze');
    expect(await screen.findByTestId('m2.snooze')).toBeOnTheScreen();
    await verb(W.urgent, 'complete');
    expect(events('waiting_action').map((e) => e.props.action)).toEqual([
      'dismiss',
      'snooze',
      'done',
    ]);
  });

  it('shows the empty state with the mail CTA', async () => {
    peopleSetup({ data: { tables: { insights: [] } } });
    const { router } = await renderApp('/waiting');
    const empty = await screen.findByTestId('waiting.empty');
    await fireEvent.press(within(empty).getByText("Mail Zekâsı'nı Aç"));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/mail');
    });
  });

  it('shows the error card when the list cannot be read', async () => {
    const { fake } = peopleSetup({ data: { failures: { insights: 'FORBIDDEN' } } });
    await renderApp('/waiting');
    const error = await screen.findByTestId('waiting.error');
    fake.data.set({ tables: TABLES });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('waiting.group.urgent')).toBeOnTheScreen();
  });
});

describe('M-FUP-01 · Senin Cevap Beklediklerin', () => {
  it('lists sent mails with their wait, focuses one and drafts a follow-up', async () => {
    const draft = {
      id: uuid(1541),
      kind: 'follow_up',
      email_message_id: M.d,
      email_thread_id: THREAD,
      connected_account_id: googleAccount.id,
      tone: 'short',
      subject: 'Re: Sözleşme',
      to: [{ email: 'ayse@demir.example' }],
      cc: [],
      body_text: 'Merhaba Ayşe Hanım, sözleşme hakkında dönüşünüzü bekliyorum.',
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
    const { api } = peopleSetup({
      api: {
        [`POST /followups/${THREAD}/draft`]: sequence(
          json(500, errorBody('INTERNAL_ERROR')),
          json(201, ok(draft)),
        ),
      },
    });
    const { router } = await renderApp(`/followups?focus=${F.recent}`);
    const old = await screen.findByTestId(`followups.card.${F.old}`);
    expect(screen.getByText('2 konu · en eskisi 10 gün')).toBeOnTheScreen();
    expect(within(old).getByText('10 gün')).toBeOnTheScreen();
    expect(within(old).getByText('Henüz yanıt yok, iki kez yazdın.')).toBeOnTheScreen();
    expect(within(old).getByText(/Outlook/)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`followups.card.${F.recent}`)).getByText('Henüz yanıt gelmedi.'),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('followup_view')).toHaveLength(1);
    });
    await fireEvent.press(within(old).getByText('Takip Mesajı Hazırla'));
    expect(await screen.findByText('Takip mesajı hazırlanamadı.')).toBeOnTheScreen();
    await fireEvent.press(within(old).getByText('Takip Mesajı Hazırla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${M.d}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({ mode: 'follow_up', origin: 'followups' });
    expect(api.calls.at(-1)?.body).toEqual({ tone: 'short' });
  });

  it('reminds tomorrow, closes and stops tracking a follow-up', async () => {
    const { fake } = peopleSetup();
    await renderApp('/followups');
    const card = (id: string) => screen.findByTestId(`followups.card.${id}`);
    await fireEvent.press(within(await card(F.old)).getByText('Yarın hatırlat'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    await fireEvent.press(within(await card(F.recent)).getByText('Kapat'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: F.recent,
        p_status: 'done',
      });
    });
    await fireEvent.press(within(await card(F.old)).getByLabelText('Diğer seçenekler'));
    await fireEvent.press(await screen.findByTestId('m2.menu.stop'));
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({
        p_insight_id: F.old,
        p_kind: 'stop_tracking',
      });
    });
    expect(
      await screen.findByText('ayse@demir.example artık takip edilmiyor.', {}, { timeout: 6000 }),
    ).toBeOnTheScreen();
    expect(events('follow_up_actioned').map((e) => e.props.action)).toEqual([
      'remind_tomorrow',
      'close',
      'stop_tracking',
    ]);
  }, 15_000);

  it('runs the follow-up swipe verbs and opens the mail', async () => {
    const { fake } = peopleSetup();
    const { router } = await renderApp('/followups');
    const old = await screen.findByTestId(`followups.card.${F.old}`);
    await fireEvent(old, 'accessibilityAction', { nativeEvent: { actionName: 'dismiss' } });
    await waitFor(() => {
      expect(fake.data.calls.some((c) => c.target === 'apply_insight_feedback')).toBe(true);
    });
    await fireEvent(
      await screen.findByTestId(`followups.card.${F.recent}`),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'snooze' },
      },
    );
    expect(await screen.findByTestId('m2.snooze')).toBeOnTheScreen();
    await fireEvent(
      await screen.findByTestId(`followups.card.${F.recent}`),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'close' },
      },
    );
    await fireEvent.press(await screen.findByTestId(`followups.card.${F.recent}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${M.e}`);
    });
  });

  it('shows the Free gate with the open follow-up count', async () => {
    setup({
      bootstrap: { counts: { pending_approvals: 0, open_followups: 4, open_commitments: 0 } },
    });
    await renderApp('/followups');
    expect(await screen.findByText('4 mailine cevap gelmedi.')).toBeOnTheScreen();
  });

  it('shows the empty state for Pro users', async () => {
    peopleSetup({ data: { tables: { insights: [] } } });
    const { router } = await renderApp('/followups');
    const empty = await screen.findByTestId('followups.empty');
    await fireEvent.press(within(empty).getByText('Taahhütleri Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/commitments');
    });
  });
});
