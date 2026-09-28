/**
 * T-8.12 · Commitments with populated data (SCREEN_AND_FLOW_MAP M-COMMIT-01 Taahhütlerin,
 * M-COMMIT-02 Taahhüt detayı, Pro): open items grouped GECİKTİ / BUGÜN / AÇIK / ERTELENDİ in the
 * user's zone, the done section, pending "Bu bir taahhüt mü?" proposals confirmed in place
 * (`approve {approved_via:'in_place'}`) or rejected (`user_reject`, learning), RPC-06
 * `set_commitment_status` done / snooze / reopen with undo, the they-owe follow-up draft, the
 * source routes; the detail's reminders (`POST /reminders/:id/cancel`), "Planla"
 * (`POST /plan/proposals`), the edit sheet and "Bu bir söz değil" (RPC-17 correction).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type Responder } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import type { DataRoutes } from '../helpers/supabase-data';
import { events, setup } from '../m2/harness';
import { back, openFrom, sequence } from './support';

// 09:30 in Istanbul on Thursday 24 September 2026.
jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const C = {
  overdue: uuid(1200),
  today: uuid(1201),
  open: uuid(1202),
  snoozed: uuid(1203),
  done: uuid(1204),
  theirs: uuid(1205),
} as const;
const MSG = uuid(1210);
const THREAD = uuid(1211);
const CONTACT = uuid(1212);
const PROPOSAL = uuid(1213);
const REMINDER = uuid(1214);
const PLAN_APPROVAL = uuid(1215);

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    direction: 'user_owes',
    status: 'open',
    text: 'Teklifi gönder',
    evidence: [{ quote: 'Teklifi Cuma gönderirim.' }],
    counterparty_name: 'Mehmet Yılmaz',
    contact_id: null,
    due_at: null,
    due_is_date_only: false,
    snoozed_until: null,
    completed_at: null,
    source_type: 'email_message',
    source_id: MSG,
    source_provider: 'google',
    source_timestamp: '2026-09-22T08:00:00Z',
    confidence: 0.92,
    user_overrides: null,
    contact: null,
    ...overrides,
  };
}

const ROWS = [
  row(C.overdue, { text: 'Raporu paylaş', due_at: '2026-09-23T09:00:00Z' }),
  row(C.today, {
    text: 'Faturayı kes',
    due_at: '2026-09-24T15:00:00Z',
    source_type: 'meeting_note',
  }),
  row(C.open, {
    text: 'Sözleşmeyi incele',
    due_at: '2026-09-28T09:00:00Z',
    due_is_date_only: true,
    confidence: 0.6,
    contact_id: CONTACT,
    contact: { display_name: 'Ayşe Demir' },
    user_overrides: { text: { value: 'Sözleşmeyi hukukla incele' } },
    source_type: 'capture',
    source_id: uuid(1216),
  }),
  row(C.snoozed, { text: 'Sunumu gönder', status: 'snoozed', due_at: '2026-09-29T09:00:00Z' }),
  row(C.done, {
    text: 'Toplantı notunu paylaş',
    status: 'done',
    completed_at: '2026-09-22T09:00:00Z',
  }),
  row(C.theirs, {
    direction: 'they_owe',
    text: 'Fiyat teklifini gönderecek',
    due_at: '2026-09-26T09:00:00Z',
    counterparty_name: 'Kerem',
  }),
];

const PROPOSAL_ROW = {
  id: PROPOSAL,
  action_type: 'commitment_create',
  status: 'pending',
  payload: {
    text: 'Kampanya taslağını gönder',
    direction: 'user_owes',
    counterparty: { email: 'kerem@ornek.example' },
    due_at: '2026-09-25T14:00:00Z',
    evidence: { quote: 'Taslağı yarın atarım.' },
  },
  payload_version: 1,
  idempotency_key: `approval:${PROPOSAL}:v1`,
  source_type: 'email_message',
  source_id: MSG,
  what: 'Kampanya taslağını gönder',
};

function commitmentApprovalView(status: string) {
  return approvalView({
    id: PROPOSAL,
    action_type: 'commitment_create',
    status,
    idempotency_key: `approval:${PROPOSAL}:v1`,
    type_label_key: 'approvals.types.commitment_create',
    side_effects: [{ code: 'internal_record', text: 'Taahhütlerine eklenir.' }],
    origin: 'commitment_detection',
  });
}

function commitmentsSetup(
  options: {
    readonly rows?: readonly Record<string, unknown>[];
    readonly api?: Readonly<Record<string, Responder>>;
    readonly data?: DataRoutes;
  } = {},
) {
  return setup({
    pro: true,
    data: {
      rpc: {
        set_commitment_status: () => null,
        submit_ai_correction: () => ({ correction_id: uuid(1220) }),
      },
      tables: {
        commitments: options.rows ?? ROWS,
        approval_actions: [PROPOSAL_ROW],
        email_messages: [{ id: MSG, thread_id: THREAD, direction: 'inbound', received_at: TS }],
        reminders: [
          {
            id: REMINDER,
            title: 'Rapor hatırlatması',
            remind_at: '2026-09-24T12:00:00Z',
            notification_id: null,
            target_type: 'commitment',
            target_id: C.overdue,
            status: 'scheduled',
          },
        ],
      },
      ...options.data,
    },
    api: options.api ?? {},
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-COMMIT-01 · Taahhütlerin', () => {
  it('groups open commitments by status in the user’s zone and shows the done section', async () => {
    commitmentsSetup();
    await renderApp('/commitments');
    expect(await screen.findByTestId('commitments.group.overdue')).toBeOnTheScreen();
    expect(screen.getByTestId('commitments.group.today')).toBeOnTheScreen();
    expect(screen.getByTestId('commitments.group.open')).toBeOnTheScreen();
    expect(screen.getByTestId('commitments.group.snoozed')).toBeOnTheScreen();
    expect(screen.getByText('3 açık · 1 gecikmiş')).toBeOnTheScreen();
    // The user's correction wins over the extracted text; low confidence is flagged.
    const open = screen.getByTestId(`commitments.card.${C.open}`);
    expect(within(open).getAllByText('Sözleşmeyi hukukla incele').length).toBeGreaterThan(0);
    expect(within(open).getByText('Ayşe Demir')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`commitments.card.${C.today}`)).getByText(/^Toplantıdan · /),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ui.accordion.header'));
    expect(await screen.findByTestId(`commitments.card.${C.done}`)).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('commitment_view')[0]?.props).toEqual({ direction: 'user_owes' });
    });
  });

  it('confirms and rejects a "Bu bir taahhüt mü?" proposal in place', async () => {
    const { api } = commitmentsSetup({
      api: {
        [`POST /approvals/${PROPOSAL}/approve`]: sequence(
          json(500, errorBody('INTERNAL_ERROR')),
          json(
            200,
            ok({
              approval: commitmentApprovalView('executed'),
              job: null,
              execution: { mode: 'server', device_token: null, instructions: null },
            }),
          ),
        ),
        [`POST /approvals/${PROPOSAL}/reject`]: () =>
          json(200, ok(commitmentApprovalView('rejected'))),
      },
    });
    await renderApp('/commitments');
    const card = await screen.findByTestId(`commitments.proposal.${PROPOSAL}`);
    expect(within(card).getByText('kerem@ornek.example')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Evet, Taahhüt'));
    expect(await screen.findByText('İşlem tamamlanamadı. Tekrar dene.')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Evet, Taahhüt'));
    await waitFor(() => {
      expect(events('commitment_confirm').at(-1)?.props).toEqual({ decision: 'confirmed' });
    });
    expect(api.calls.filter((c) => c.url.endsWith('/approve')).at(-1)?.body).toEqual({
      idempotency_key: `approval:${PROPOSAL}:v1`,
      payload_version: 1,
      approved_via: 'in_place',
    });
    await fireEvent.press(within(card).getByText('Hayır'));
    await waitFor(() => {
      expect(events('commitment_confirm').at(-1)?.props).toEqual({ decision: 'rejected' });
    });
    expect(api.calls.find((c) => c.url.endsWith('/reject'))?.body).toEqual({
      reason: 'user_reject',
      learn: true,
    });
  });

  it('marks done with set_commitment_status, snoozes from the sheet and opens the source', async () => {
    const { fake } = commitmentsSetup();
    const { router } = await renderApp('/commitments');
    const overdue = await screen.findByTestId(`commitments.card.${C.overdue}`);
    await fireEvent.press(within(overdue).getByText('Tamamlandı'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_commitment_status')?.args).toMatchObject(
        {
          p_commitment_id: C.overdue,
          p_status: 'done',
        },
      );
    });
    await fireEvent.press(
      within(screen.getByTestId(`commitments.card.${C.today}`)).getByText('Ertele'),
    );
    expect(await screen.findByTestId('m2.snooze')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('m2.snooze.morning'));
    await waitFor(() => {
      expect(
        fake.data.calls.filter((c) => c.target === 'set_commitment_status').at(-1)?.args,
      ).toMatchObject({ p_commitment_id: C.today, p_status: 'snoozed' });
    });
    await fireEvent.press(
      within(screen.getByTestId(`commitments.card.${C.overdue}`)).getByText('Kaynağı Gör'),
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}`);
    });
    expect(events('commitment_action').map((e) => e.props.action)).toEqual([
      'done',
      'snooze',
      'source',
    ]);
    await back();
    await fireEvent(
      await screen.findByTestId(`commitments.card.${C.today}`),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'open' },
      },
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/commitments/${C.today}`);
    });
  });

  it('drafts a follow-up for a promise made to the user (they_owe, mail source)', async () => {
    const draft = {
      id: uuid(1230),
      kind: 'follow_up',
      email_message_id: MSG,
      email_thread_id: THREAD,
      connected_account_id: googleAccount.id,
      tone: 'short',
      subject: 'Re: Fiyat',
      to: [{ email: 'kerem@ornek.example' }],
      cc: [],
      body_text: 'Merhaba Kerem, teklifi bekliyorum.',
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
    const { api } = commitmentsSetup({
      api: {
        [`POST /followups/${THREAD}/draft`]: sequence(
          json(500, errorBody('INTERNAL_ERROR')),
          json(201, ok(draft)),
        ),
      },
    });
    const { router } = await renderApp('/commitments?direction=they_owe');
    const card = await screen.findByTestId(`commitments.card.${C.theirs}`);
    expect(screen.getByText('Sana verilen 1 açık söz')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Takip Mesajı Hazırla'));
    expect(await screen.findByText('İşlem tamamlanamadı. Tekrar dene.')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Takip Mesajı Hazırla'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}/reply`);
    });
    expect(router.getSearchParams()).toMatchObject({
      mode: 'follow_up',
      origin: 'commitments',
    });
    expect(api.calls.at(-1)?.body).toEqual({ tone: 'short' });
  });

  it('shows the empty states per direction and the load error', async () => {
    commitmentsSetup({ rows: [], data: { tables: { approval_actions: [] } } });
    await renderApp('/commitments');
    expect(await screen.findByText('Açık taahhüdün yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ui.segmentedControl.they_owe'));
    expect(await screen.findByText('Sana verilen açık bir söz yok.')).toBeOnTheScreen();
    expect(events('commitment_view').map((e) => e.props.direction)).toEqual([
      'user_owes',
      'they_owe',
    ]);
  });

  it('shows the error state and retries', async () => {
    const { fake } = commitmentsSetup({ data: { failures: { commitments: 'FORBIDDEN' } } });
    await renderApp('/commitments');
    const error = await screen.findByTestId('commitments.error');
    fake.data.set({ tables: { commitments: ROWS, approval_actions: [] } });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByTestId('commitments.group.overdue')).toBeOnTheScreen();
  });
});

describe('M-COMMIT-02 · Taahhüt detayı', () => {
  it('shows the fields and reminders, cancels a reminder and plans time before the due date', async () => {
    const { api } = commitmentsSetup({
      api: {
        [`POST /reminders/${REMINDER}/cancel`]: () =>
          json(
            200,
            ok({
              id: REMINDER,
              title: 'Rapor hatırlatması',
              preset: 'custom',
              fire_at: '2026-09-24T12:00:00Z',
              time_zone: 'Europe/Istanbul',
              channel: 'push',
              status: 'cancelled',
              reason_text: null,
              subject: { type: 'commitment', id: C.overdue },
              created_at: TS,
            }),
          ),
        'POST /plan/proposals': sequence(
          json(409, errorBody('STATE_CONFLICT')),
          json(
            201,
            ok({
              insight_id: uuid(1231),
              slot: { start: '2026-09-24T10:00:00Z', end: '2026-09-24T11:00:00Z' },
              alternatives: [],
              rationale_text: 'Boş zaman.',
              approval: approvalView({
                id: PLAN_APPROVAL,
                idempotency_key: `approval:${PLAN_APPROVAL}:v1`,
                action_type: 'calendar_create',
                type_label_key: 'approvals.types.calendar_create',
                origin: 'plan_proposal',
                side_effects: [],
                destination: {
                  target_kind: 'provider',
                  provider: 'google',
                  account_label: 'ahmet@example.com',
                  container_label: null,
                },
              }),
            }),
          ),
        ),
      },
    });
    const { router } = await renderApp(`/commitments/${C.overdue}`);
    expect(await screen.findByText('Gecikti'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.getByText('“Teklifi Cuma gönderirim.”')).toBeOnTheScreen();
    expect(screen.getByText('%92 güven')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('commitment_detail_view')[0]?.props).toEqual({
        direction: 'user_owes',
        status: 'open',
      });
    });
    await fireEvent.press(screen.getByText('Rapor hatırlatması'));
    await waitFor(() => {
      expect(api.calls.find((c) => c.url.endsWith('/cancel'))?.body).toEqual({
        reason: 'user_cancel',
      });
    });
    await fireEvent.press(screen.getByTestId('commitment.plan'));
    expect(
      await screen.findByText('Son tarihten önce uygun boş zaman bulunamadı.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('commitment.plan'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/plan/proposal/${PLAN_APPROVAL}`);
    });
    expect(api.calls.filter((c) => c.url.endsWith('/plan/proposals')).at(-1)?.body).toMatchObject({
      item: { type: 'commitment', id: C.overdue },
      duration_minutes: 60,
      window: { from: '2026-09-24T06:35:00.000Z', to: '2026-09-24T07:35:00.000Z' },
    });
  });

  it('edits the text and removes the due date through submit_ai_correction', async () => {
    const { fake } = commitmentsSetup();
    await renderApp(`/commitments/${C.open}`);
    expect(await screen.findByText('Düzeltildi')).toBeOnTheScreen();
    expect(screen.getByText('Emin değilim')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('commitment.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.edit'));
    const field = await screen.findByTestId('commitment.edit.text');
    await fireEvent.changeText(field, '   ');
    expect(await screen.findByText('Taahhüt metni boş olamaz.')).toBeOnTheScreen();
    await fireEvent.changeText(field, 'Sözleşmeyi Cuma incele');
    await fireEvent.press(screen.getByTestId('commitment.edit.save'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'submit_ai_correction')?.args).toEqual({
        p_target_type: 'commitment',
        p_target_id: C.open,
        p_kind: 'other',
        p_field: 'text',
        p_corrected: 'Sözleşmeyi Cuma incele',
      });
    });
    expect(await screen.findByText('Taahhüt güncellendi.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('commitment.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.edit'));
    await fireEvent.press(await screen.findByText('Son Tarihi Kaldır'));
    await waitFor(() => {
      expect(
        fake.data.calls.filter((c) => c.target === 'submit_ai_correction').at(-1)?.args,
      ).toMatchObject({ p_kind: 'date', p_field: 'due_at', p_corrected: null });
    });
    expect(events('ai_correction').map((e) => e.props.kind)).toEqual(['inaccurate', 'wrong_date']);
  });

  it('"Bu bir söz değil" cancels it, records the correction and goes back', async () => {
    const { fake } = commitmentsSetup();
    const { router } = await openFrom('/flow', 'flow.screen', `/commitments/${C.today}`);
    await fireEvent.press(await screen.findByTestId('commitment.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.not'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/flow');
    });
    expect(fake.data.calls.find((c) => c.target === 'set_commitment_status')?.args).toEqual({
      p_commitment_id: C.today,
      p_status: 'cancelled',
    });
    expect(fake.data.calls.find((c) => c.target === 'submit_ai_correction')?.args).toMatchObject({
      p_kind: 'not_commitment',
    });
    expect(events('ai_correction').at(-1)?.props).toEqual({
      target: 'commitment',
      kind: 'not_a_commitment',
    });
  });

  it('reopens a recently done commitment and opens the contact', async () => {
    const { fake } = commitmentsSetup();
    await renderApp(`/commitments/${C.done}`);
    await fireEvent.press(await screen.findByTestId('commitment.reopen'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_commitment_status')?.args).toMatchObject(
        {
          p_commitment_id: C.done,
          p_status: 'open',
        },
      );
    });
    expect(await screen.findByText('Taahhüt yeniden açıldı.')).toBeOnTheScreen();
  });

  it('opens the contact of a commitment', async () => {
    commitmentsSetup();
    const { router } = await renderApp(`/commitments/${C.open}`);
    await fireEvent.press(await screen.findByText('Ayşe Demir'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/person/${CONTACT}`);
    });
  });

  it('shows "Bu taahhüt artık yok." for a missing commitment', async () => {
    commitmentsSetup({ rows: [] });
    await renderApp(`/commitments/${C.overdue}`);
    expect(await screen.findByText('Bu taahhüt artık yok.')).toBeOnTheScreen();
  });
});
