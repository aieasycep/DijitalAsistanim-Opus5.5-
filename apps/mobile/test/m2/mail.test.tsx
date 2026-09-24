/**
 * T-8.11 · Mail Intelligence, Email Detail and AI Reply: category routing (awaiting-reply
 * categories open Waiting / Follow-ups), the original mail is fetched on demand with remote images
 * blocked and never persisted, and a reply is sent only through its `email_send` approval, approved
 * in place after the user's tap (R-03) — never while offline.
 */
import { qk } from '@da/api-client';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { json, renderApp, resetAppState } from '../helpers/app';
import { googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { categoryRoute } from '../../src/features/mail/MailScreens';
import { getQueryClient } from '../../src/lib/query/client';
import { events, setup, SOURCE } from './harness';

const MESSAGE = uuid(90);
const THREAD = uuid(91);
const DRAFT = uuid(20);
const APPROVAL = uuid(30);

const messageRow = {
  id: MESSAGE,
  thread_id: THREAD,
  connected_account_id: googleAccount.id,
  provider: 'google',
  direction: 'inbound',
  from_name: 'Mehmet Yılmaz',
  from_email: 'mehmet@yilmaz.example',
  to_emails: ['ahmet@example.com'],
  cc_emails: [],
  received_at: TS,
  subject: 'Teklif',
  ai_summary: 'Mehmet Bey revize teklifi yarın bekliyor.',
  key_points: [],
  ai_status: 'done',
  classification: 'awaiting_my_reply',
  classification_tier: 'ai_classification',
  classification_reason: null,
  classification_confidence: 0.9,
  has_attachments: false,
  attachment_meta: [],
  injection_suspected: false,
  web_link: null,
};

const draft = {
  id: DRAFT,
  kind: 'reply',
  email_message_id: MESSAGE,
  email_thread_id: THREAD,
  connected_account_id: googleAccount.id,
  tone: 'professional',
  subject: 'Re: Teklif',
  to: [{ email: 'mehmet@yilmaz.example', name: 'Mehmet Yılmaz' }],
  cc: [],
  body_text: 'Merhaba Mehmet Bey, revize teklifi yarın iletiyorum.',
  language: 'tr',
  version: 1,
  status: 'draft',
  attachments: [],
  grounding: { facts_used: [SOURCE] },
  warnings: [],
  approval_id: null,
  web_link: null,
  created_at: TS,
  updated_at: TS,
};

const emailApproval = {
  id: APPROVAL,
  action_type: 'email_send',
  status: 'pending',
  payload_version: 1,
  idempotency_key: `approval:${APPROVAL}:v1`,
  type_label_key: 'approvals.type.email_send',
  what: { title: 'Re: Teklif', summary: 'Mehmet Yılmaz kişisine gönderilir.' },
  why: { text: 'Yanıtını onayladın.', reason_code: 'reply_draft' },
  source: SOURCE,
  exact_change: {
    kind: 'send',
    fields: [{ field: 'to', before: null, after: 'mehmet@yilmaz.example' }],
  },
  destination: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'ahmet@example.com · Gmail',
    container_label: null,
  },
  side_effects: [{ code: 'email_sent_to', text: 'Mehmet Yılmaz kişisine mail gider.' }],
  scope_status: { state: 'granted' },
  requires_confirmation: true,
  pro_required: false,
  origin: 'reply_draft',
  origin_ref_id: DRAFT,
  executor: 'server',
  device_installation_id: null,
  batch_id: null,
  created_at: TS,
  approval_expires_at: '2026-09-30T08:00:00Z',
  approved_at: null,
  rejected_at: null,
  approved_via: null,
  executed_at: null,
  result: null,
  failure: null,
};

const sendAccount = {
  ...googleAccount,
  capabilities_granted: [...googleAccount.capabilities_granted, 'mail_send' as const],
};

beforeEach(async () => {
  await resetAppState();
});

describe('M-MAIL-01 · category routing', () => {
  it('opens Waiting and Follow-ups for the awaiting-reply categories', () => {
    expect(categoryRoute('awaiting_my_reply', 'all')).toBe('/waiting');
    expect(categoryRoute('awaiting_their_reply', 'all')).toBe('/followups');
    expect(categoryRoute('important', uuid(10))).toBe(
      `/mail/category/important?account=${uuid(10)}`,
    );
  });
});

describe('M-MAIL-03 · Orijinal Mail', () => {
  it('fetches the original with remote images blocked and keeps it out of the persisted cache', async () => {
    const { api } = setup({
      data: { tables: { email_messages: [messageRow] } },
      api: {
        [`GET /mail/${MESSAGE}/original`]: () =>
          json(
            200,
            ok({
              message_id: MESSAGE,
              subject: 'Teklif',
              from: { email: 'mehmet@yilmaz.example', name: 'Mehmet Yılmaz' },
              to: [{ email: 'ahmet@example.com' }],
              cc: [],
              date: TS,
              body: {
                format: 'text',
                content: 'Revize teklifi yarın bekliyoruz.',
                truncated: false,
                remote_images_blocked: true,
              },
              attachments: [],
              web_link: null,
              fetched_at: TS,
            }),
          ),
      },
    });
    await renderApp(`/mail/${MESSAGE}`);
    expect(await screen.findByTestId('email.subject')).toBeOnTheScreen();
    expect(api.calls.some((c) => c.url.includes('/original'))).toBe(false);
    await fireEvent.press(
      within(screen.getByTestId('email.original')).getByTestId('ui.accordion.header'),
    );
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.includes('/original'))).toBe(true);
    });
    expect(await screen.findByTestId('email.original.body')).toBeOnTheScreen();
    const call = api.calls.find((c) => c.url.includes('/original'));
    expect(call?.url).toContain('remote_images=blocked');
    const cached = getQueryClient()
      .getQueryCache()
      .find({ queryKey: qk.mail.original(MESSAGE) });
    expect(cached).toBeDefined();
    expect(cached?.meta?.persist).not.toBe(true);
  });
});

describe('M-REPLY-01 · AI yanıt', () => {
  function replySetup() {
    return setup({
      bootstrap: { accounts: [sendAccount] },
      data: { tables: { email_messages: [messageRow] } },
      api: {
        [`POST /mail/${MESSAGE}/reply-drafts`]: () => json(201, ok(draft)),
        [`POST /reply-drafts/${DRAFT}/submit`]: () =>
          json(
            200,
            ok({
              draft: { ...draft, status: 'submitted', approval_id: APPROVAL },
              approval: emailApproval,
            }),
          ),
        [`POST /approvals/${APPROVAL}/approve`]: () =>
          json(
            200,
            ok({
              approval: {
                ...emailApproval,
                status: 'executed',
                approved_at: TS,
                approved_via: 'in_place',
                executed_at: TS,
              },
              job: null,
              execution: { mode: 'server', device_token: null, instructions: null },
            }),
          ),
      },
    });
  }

  it('sends only through the approval, approved in place after the tap', async () => {
    const { api } = replySetup();
    await renderApp(`/mail/${MESSAGE}/reply`);
    expect(await screen.findByDisplayValue(draft.body_text)).toBeOnTheScreen();
    expect(api.calls.some((c) => c.url.includes('/approve'))).toBe(false);
    await fireEvent.press(screen.getByTestId('reply.approve'));
    await waitFor(
      () => {
        expect(api.calls.some((c) => c.url.endsWith(`/approvals/${APPROVAL}/approve`))).toBe(true);
      },
      { timeout: 8000 },
    );
    const approve = api.calls.find((c) => c.url.endsWith('/approve'));
    expect(approve?.body).toEqual({
      idempotency_key: emailApproval.idempotency_key,
      payload_version: 1,
      approved_via: 'in_place',
    });
    expect(await screen.findByTestId('reply.sent')).toBeOnTheScreen();
  }, 20_000);

  it('blocks sending while offline', async () => {
    const { api } = replySetup();
    await renderApp(`/mail/${MESSAGE}/reply`);
    expect(await screen.findByDisplayValue(draft.body_text)).toBeOnTheScreen();
    onlineManager.setOnline(false);
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(events('offline_blocked_action').at(-1)?.props).toEqual({ action: 'approve' });
    expect(api.calls.some((c) => c.url.includes('/submit'))).toBe(false);
  });
});
