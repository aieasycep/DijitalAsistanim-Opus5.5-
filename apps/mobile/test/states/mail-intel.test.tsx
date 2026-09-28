/**
 * T-8.11 · Mail Zekâsı with populated data (SCREEN_AND_FLOW_MAP M-MAIL-01, M-MAIL-02): the digest
 * hero from RPC-08 `mail_intelligence` (total, attention, analysed / pending), the category rows and
 * their routes, the important thread cards with their one action (reply, "Takvime Ekle" through
 * `POST /approvals`, open), the "···" correction written to `ai_feedback` with undo, the account
 * filter, the no-account / error states, and a category drilled down day by day with paging.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import type { RpcHandler } from '../helpers/supabase-data';
import { events, setup } from '../m2/harness';
import { back } from './support';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const T = { reply: uuid(1600), deadline: uuid(1601), info: uuid(1602), old: uuid(1603) };
const MSG = uuid(1610);
const OUTLOOK = uuid(1611);

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    thread_id: id,
    connected_account_id: googleAccount.id,
    provider: 'google',
    subject: 'Teklif',
    participants: [{ name: 'Mehmet Yılmaz', email: 'mehmet@yilmaz.example', role: 'from' }],
    message_count: 2,
    last_message_at: '2026-09-24T05:30:00Z',
    has_unread: true,
    category: 'important',
    urgency: 'normal',
    reply_state: null,
    ai_summary: 'Mehmet Bey revize teklifi istiyor. Yarın dönüş bekliyor.',
    deadline_at: null,
    ...overrides,
  };
}

const ROWS = [
  thread(T.reply, { reply_state: 'awaiting_my_reply', urgency: 'urgent' }),
  thread(T.deadline, {
    subject: 'Sözleşme imzası',
    participants: [{ email: 'hukuk@demir.example' }],
    deadline_at: '2026-09-26T12:00:00Z',
    ai_summary: null,
    last_message_at: '2026-09-22T08:00:00Z',
  }),
  thread(T.info, { subject: null, participants: 'bozuk', ai_summary: '' }),
];

function intel(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    local_date: '2026-09-24',
    total: 18,
    attention: 4,
    counts: {
      important: 3,
      awaiting_my_reply: 2,
      awaiting_their_reply: 1,
      has_deadline: 1,
      informational: 5,
      low_priority: 6,
      unclassified: 2,
    },
    rows,
    next_cursor: null,
    ...overrides,
  };
}

function mailSetup(handler: RpcHandler = () => intel(ROWS), accounts?: readonly unknown[]) {
  return setup({
    ...(accounts === undefined ? {} : { bootstrap: { accounts: accounts as never } }),
    data: {
      rpc: { mail_intelligence: handler },
      tables: {
        email_messages: [
          { id: MSG, thread_id: T.reply, direction: 'inbound', received_at: TS },
          { id: uuid(1612), thread_id: T.info, direction: 'inbound', received_at: TS },
        ],
        calendars: [
          { id: uuid(12), connected_account_id: googleAccount.id, can_write: true, selected: true },
        ],
      },
    },
    api: {
      'POST /approvals': () =>
        json(
          201,
          ok(
            approvalView({
              action_type: 'calendar_create',
              type_label_key: 'approvals.types.calendar_create',
              origin: 'email_detail',
              side_effects: [],
              destination: {
                target_kind: 'provider',
                provider: 'google',
                account_label: 'ahmet@example.com',
                container_label: null,
              },
            }),
          ),
        ),
    },
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-MAIL-01 · Mail Zekâsı', () => {
  it('shows the digest, pending analysis and the category routes', async () => {
    mailSetup();
    const { router } = await renderApp('/mail');
    const hero = await screen.findByTestId('mail.hero');
    expect(within(hero).getByText('18')).toBeOnTheScreen();
    expect(screen.getByTestId('mail.pending')).toHaveTextContent(
      '18 mailin 16 tanesi analiz edildi.',
    );
    expect(
      screen.getByText(/16 maili okudum\. 6 tanesi düşük öncelikli, 5 tanesi bilgilendirme\./),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('mail_intel_view')[0]?.props).toEqual({
        accounts_count: 1,
        has_pending_analysis: true,
      });
    });
    for (const [category, path] of [
      ['awaiting_my_reply', '/waiting'],
      ['awaiting_their_reply', '/followups'],
      ['has_deadline', '/mail/category/has_deadline'],
    ] as const) {
      await fireEvent.press(await screen.findByTestId(`mail.category.${category}`));
      await waitFor(() => {
        expect(router.getPathname()).toBe(path);
      });
      await back();
    }
    expect(events('mail_category_open').map((e) => e.props.category)).toEqual([
      'awaiting_my_reply',
      'awaiting_their_reply',
      'has_deadline',
    ]);
  });

  it('runs each card action: reply, add to calendar and open', async () => {
    const { api } = mailSetup();
    const { router } = await renderApp('/mail');
    const reply = await screen.findByTestId(`mail.card.${T.reply}`);
    expect(within(reply).getByText('Mehmet Bey revize teklifi istiyor.')).toBeOnTheScreen();
    await fireEvent.press(within(reply).getByText('Yanıt Hazırla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}/reply`);
    });
    await back();
    const deadline = await screen.findByTestId(`mail.card.${T.deadline}`);
    expect(within(deadline).getByText('hukuk@demir.example')).toBeOnTheScreen();
    await fireEvent.press(within(deadline).getByText('Takvime Ekle'));
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
    expect(api.calls.find((c) => c.url.endsWith('/approvals'))?.body).toMatchObject({
      payload: { action_type: 'calendar_create', title: 'Sözleşme imzası' },
      origin: 'email_detail',
      source: { source_type: 'email_thread', source_id: T.deadline },
    });
    // No summary and no subject → "Konu yok"; "Aç" opens the latest inbound message.
    const info = screen.getByTestId(`mail.card.${T.info}`);
    expect(within(info).getAllByText('Konu yok').length).toBeGreaterThan(0);
    await fireEvent.press(within(info).getByText('Aç'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${uuid(1612)}`);
    });
    expect(events('mail_card_action').map((e) => e.props.action)).toEqual([
      'reply',
      'remind',
      'open',
    ]);
  });

  it('records "Önemli değil" in ai_feedback and deletes it on undo', async () => {
    const { fake } = mailSetup();
    await renderApp('/mail');
    await fireEvent.press(
      within(await screen.findByTestId(`mail.card.${T.reply}`)).getByLabelText('Diğer seçenekler'),
    );
    await fireEvent.press(await screen.findByTestId('m2.menu.not_important'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.kind === 'insert')).toMatchObject({
        target: 'ai_feedback',
        args: {
          feature: 'email_triage',
          target_type: 'email_thread',
          target_id: T.reply,
          rating: -1,
          reason_code: 'not_important',
        },
      });
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(fake.data.calls.some((c) => c.kind === 'delete' && c.target === 'ai_feedback')).toBe(
        true,
      );
    });
    expect(events('correction_undo').at(-1)?.props).toEqual({ kind: 'not_important' });
  });

  it('filters by account (paused accounts are labelled) and re-queries', async () => {
    const outlook = {
      ...googleAccount,
      id: OUTLOOK,
      provider: 'microsoft' as const,
      display_name: null,
      account_email: 'ahmet@sirket.example',
      data_sources: { ...googleAccount.data_sources, mail_read: false },
    };
    const { fake } = mailSetup(() => intel([]), [googleAccount, outlook]);
    await renderApp('/mail');
    const filters = await screen.findByTestId('mail.accounts');
    expect(within(filters).getByText('ahmet@sirket.example · duraklatıldı')).toBeOnTheScreen();
    await fireEvent.press(within(filters).getByText('ahmet@sirket.example · duraklatıldı'));
    await waitFor(() => {
      expect(
        fake.data.calls.some(
          (c) =>
            c.target === 'mail_intelligence' &&
            (c.args as { p_account_id?: string }).p_account_id === OUTLOOK,
        ),
      ).toBe(true);
    });
  });

  it('shows "Bugün mail gelmedi." for an empty day and the no-account state', async () => {
    mailSetup(() => intel([], { total: 0, attention: 0, counts: {} }));
    await renderApp('/mail');
    expect(await screen.findByText('Bugün mail gelmedi.')).toBeOnTheScreen();
    expect(screen.getByText('Yeni mail geldiğinde burada özetlerim.')).toBeOnTheScreen();
  });

  it('asks to connect a mail account when none reads mail', async () => {
    mailSetup(undefined, [{ ...googleAccount, capabilities_granted: ['calendar_read'] }]);
    const { router } = await renderApp('/mail');
    const empty = await screen.findByTestId('mail.noAccount');
    await fireEvent.press(within(empty).getByText('Hesap Bağla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });

  it('shows the error state and retries', async () => {
    const { fake } = setup({ data: { failures: { mail_intelligence: 'FORBIDDEN' } } });
    await renderApp('/mail');
    const error = await screen.findByTestId('mail.error');
    fake.data.set({ rpc: { mail_intelligence: () => intel(ROWS) } });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('mail.hero')).toBeOnTheScreen();
  });
});

describe('M-MAIL-02 · category list', () => {
  it('pages a category day by day and marks a thread as important', async () => {
    const { fake } = mailSetup((args) => {
      if (args.p_local_date === '2026-09-24') {
        return args.p_cursor === 'c2'
          ? intel([thread(T.old, { subject: 'İkinci sayfa' })])
          : {
              ...intel([thread(T.info, { subject: 'Bülten', ai_summary: 'Haftalık bülten.' })]),
              next_cursor: 'c2',
            };
      }
      if (args.p_local_date === '2026-09-23') {
        return intel([
          thread(uuid(1620), { subject: 'Dünkü bülten', last_message_at: '2026-09-23T08:00:00Z' }),
        ]);
      }
      return intel([]);
    });
    await renderApp('/mail/category/informational');
    expect(await screen.findByText('Haftalık bülten.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('mail_category_list_view')[0]?.props).toEqual({ category: 'informational' });
    });
    await fireEvent.press(screen.getByTestId('mailCategory.more'));
    expect(await screen.findByTestId(`mail.card.${T.old}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('mailCategory.more'));
    // The next page is the previous local day.
    await waitFor(() => {
      expect(
        fake.data.calls.some(
          (c) =>
            c.target === 'mail_intelligence' &&
            (c.args as { p_local_date?: string }).p_local_date === '2026-09-23',
        ),
      ).toBe(true);
    });
    await fireEvent.press(
      within(await screen.findByTestId(`mail.card.${T.info}`)).getByLabelText('Diğer seçenekler'),
    );
    await fireEvent.press(await screen.findByTestId('m2.menu.show_more'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.kind === 'insert')?.args).toMatchObject({
        rating: 1,
        reason_code: 'show_more',
      });
    });
  });

  it('shows the not-found state for a category that has no list', async () => {
    mailSetup();
    await renderApp('/mail/category/awaiting_my_reply');
    // The reply categories live in Waiting / Follow-ups: no drill-down list exists.
    expect(await screen.findByText('Bu sayfa bulunamadı.')).toBeOnTheScreen();
  });
});
