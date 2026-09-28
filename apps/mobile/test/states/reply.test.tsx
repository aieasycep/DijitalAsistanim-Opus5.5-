/**
 * T-8.11 · AI Yanıt Taslağı with its data variants (SCREEN_AND_FLOW_MAP M-REPLY-01, M-REPLY-02
 * progressive send scope, API-MAIL-02…05, API-INT-02, API-APR-03): generation failure and quota,
 * tone changes (`POST /reply-drafts/:id/regenerate`, the overwrite confirmation and its undo),
 * autosave (`PATCH /reply-drafts/:id`) and the version conflict, "Kısalt", attachments
 * (`POST /reply-drafts/:id/attachments/upload-url`), the send path (submit → approve in place,
 * the hash-mismatch sheet, 413 / 409 / failures, the missing `mail_send` scope before and after
 * submit), the send status polled until `executed` / `failed`, stored drafts and approvals being
 * edited, follow-up mode and closing with unsaved edits.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { json, renderApp, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { errorBody, googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { events, setup, SOURCE } from '../m2/harness';
import { openFrom, sequence } from './support';

type AuthSessionResult = Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;

const MESSAGE = uuid(1000);
const THREAD = uuid(1001);
const DRAFT = uuid(1002);
const APPROVAL = uuid(1003);
const EDITED = uuid(1004);

const sendAccount = {
  ...googleAccount,
  capabilities_granted: [...googleAccount.capabilities_granted, 'mail_send' as const],
};

const messageRow = { id: MESSAGE, thread_id: THREAD, direction: 'inbound', received_at: TS };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT,
    kind: 'reply',
    email_message_id: MESSAGE,
    email_thread_id: THREAD,
    connected_account_id: googleAccount.id,
    tone: 'professional',
    subject: 'Re: Teklif',
    to: [{ email: 'mehmet@yilmaz.example', name: 'Mehmet Yılmaz' }],
    cc: [{ email: 'ayse@demir.example' }],
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
    ...overrides,
  };
}

function emailApproval(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

const submitted = () =>
  json(
    200,
    ok({
      draft: draft({ status: 'submitted', approval_id: APPROVAL }),
      approval: emailApproval(),
    }),
  );

function approved(status: 'executed' | 'executing') {
  return json(
    200,
    ok({
      approval: emailApproval({
        status,
        approved_at: TS,
        approved_via: 'in_place',
        executed_at: status === 'executed' ? TS : null,
      }),
      job: null,
      execution: { mode: 'server', device_token: null, instructions: null },
    }),
  );
}

interface Options {
  readonly accounts?: readonly unknown[];
  readonly api?: Readonly<Record<string, Responder>>;
  readonly tables?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly pro?: boolean;
}

function replySetup(options: Options = {}) {
  return setup({
    pro: options.pro ?? false,
    bootstrap: { accounts: [...((options.accounts ?? [sendAccount]) as (typeof sendAccount)[])] },
    data: { tables: { email_messages: [messageRow], ...options.tables } },
    api: {
      [`POST /mail/${MESSAGE}/reply-drafts`]: () => json(201, ok(draft())),
      [`POST /reply-drafts/${DRAFT}/submit`]: submitted,
      [`POST /approvals/${APPROVAL}/approve`]: () => approved('executed'),
      [`PATCH /reply-drafts/${DRAFT}`]: (call) =>
        json(200, ok(draft({ ...(call.body as object), version: 2 }))),
      ...options.api,
    },
  });
}

async function openReply(path = `/mail/${MESSAGE}/reply`) {
  const rendered = await renderApp(path);
  await screen.findByTestId('ui.draftEditorCard.input');
  return rendered;
}

function calls(api: { calls: readonly RecordedCall[] }, end: string) {
  return api.calls.filter((c) => c.url.endsWith(end));
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-REPLY-01 · generation states', () => {
  it('shows "Asistan şu an yanıt veremiyor." on a failure and retries with the same intent', async () => {
    const { api } = replySetup({
      api: {
        [`POST /mail/${MESSAGE}/reply-drafts`]: sequence(
          json(500, errorBody('INTERNAL_ERROR')),
          json(201, ok(draft())),
        ),
      },
    });
    await renderApp(`/mail/${MESSAGE}/reply`);
    const error = await screen.findByTestId('reply.error');
    expect(events('reply_draft_created')[0]?.props).toEqual({
      tone: 'professional',
      result: 'error',
    });
    await fireEvent.press(within(error).getByText('Tekrar Dene'));
    expect(await screen.findByDisplayValue(draft().body_text)).toBeOnTheScreen();
    const [first, second] = calls(api, '/reply-drafts');
    expect(first?.headers['idempotency-key']).toBe(second?.headers['idempotency-key']);
    expect(second?.body).toEqual({ tone: 'professional' });
  });

  it('shows the AI limit card when the quota is used up', async () => {
    replySetup({
      api: {
        [`POST /mail/${MESSAGE}/reply-drafts`]: () => json(429, errorBody('QUOTA_EXCEEDED')),
      },
    });
    await renderApp(`/mail/${MESSAGE}/reply?tone=short`);
    expect(await screen.findByTestId('reply.budget')).toBeOnTheScreen();
    expect(
      screen.getByText("Hakkın yarın yenilenir. Pro'da günlük sınır daha yüksek."),
    ).toBeOnTheScreen();
    expect(events('reply_draft_created')[0]?.props).toEqual({
      tone: 'short',
      result: 'budget_exhausted',
    });
  });

  it('drafts a follow-up from the thread (POST /followups/:threadId/draft)', async () => {
    const { api } = replySetup({
      api: {
        [`POST /followups/${THREAD}/draft`]: () =>
          json(201, ok(draft({ kind: 'follow_up', tone: 'short' }))),
      },
    });
    await renderApp(`/mail/${MESSAGE}/reply?mode=follow_up`);
    expect(await screen.findByText('Takip Mesajı'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(calls(api, `/followups/${THREAD}/draft`)[0]?.body).toEqual({ tone: 'short' });
    expect(events('follow_up_draft_created')[0]?.props).toEqual({ tone: 'short', result: 'ok' });
  });

  it('continues a stored draft (draftId) mapped from its reply_drafts row', async () => {
    replySetup({
      tables: {
        reply_drafts: [
          {
            id: DRAFT,
            kind: 'reply',
            message_id: MESSAGE,
            thread_id: THREAD,
            connected_account_id: googleAccount.id,
            tone: 'friendly',
            status: 'draft',
            body: 'Kaydedilmiş taslak metni.',
            to_emails: ['mehmet@yilmaz.example'],
            cc_emails: [],
            subject: 'Re: Teklif',
            version: 3,
            attachments: [
              {
                storage_path: 'a/b.pdf',
                name: 'teklif.pdf',
                mime: 'application/pdf',
                size_bytes: 2048,
              },
            ],
            approval_action_id: null,
            language: 'tr',
            warnings: [],
            created_at: TS,
            updated_at: TS,
          },
        ],
      },
    });
    await openReply(`/mail/${MESSAGE}/reply?draftId=${DRAFT}`);
    expect(screen.getByDisplayValue('Kaydedilmiş taslak metni.')).toBeOnTheScreen();
    expect(screen.getByText(/teklif\.pdf/)).toBeOnTheScreen();
    expect(screen.getByText('Taslak · Samimi'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
  });
});

describe('M-REPLY-01 · editing', () => {
  it('regenerates in another tone; an edited draft asks first and the rewrite can be undone', async () => {
    const { api } = replySetup({
      api: {
        [`POST /reply-drafts/${DRAFT}/regenerate`]: (call) =>
          json(
            200,
            ok(
              draft({
                tone: (call.body as { tone: string }).tone,
                body_text: `Yeni ${(call.body as { tone: string }).tone} metin.`,
                version: 2,
              }),
            ),
          ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('ui.segmentedControl.short'));
    expect(await screen.findByDisplayValue('Yeni short metin.')).toBeOnTheScreen();
    expect(calls(api, '/regenerate')[0]?.body).toEqual({ tone: 'short', expected_version: 1 });

    await fireEvent.changeText(screen.getByTestId('ui.draftEditorCard.input'), 'Benim metnim.');
    await fireEvent.press(screen.getByTestId('ui.segmentedControl.friendly'));
    expect(
      await screen.findByText(
        'Taslak Samimi tonla yeniden yazılsın mı? Yaptığın değişiklikler kaybolur.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('m2.menu.cancel'));
    expect(events('reply_tone_overwrite').at(-1)?.props).toEqual({ confirmed: false });
    await fireEvent.press(screen.getByTestId('ui.segmentedControl.friendly'));
    await fireEvent.press(await screen.findByTestId('m2.menu.rewrite'));
    expect(await screen.findByDisplayValue('Yeni friendly metin.')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText('Geri al'));
    expect(await screen.findByDisplayValue('Benim metnim.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(
        calls(api, `/reply-drafts/${DRAFT}`).some(
          (c) =>
            c.method === 'PATCH' &&
            (c.body as { body_text?: string }).body_text === 'Benim metnim.',
        ),
      ).toBe(true);
    });
    expect(events('reply_tone_change').map((e) => e.props.tone)).toEqual([
      'short',
      'friendly',
      'friendly',
    ]);
  });

  it('autosaves edits and offers "Son Hali Yükle" after a version conflict', async () => {
    const { api } = replySetup({
      api: { [`PATCH /reply-drafts/${DRAFT}`]: () => json(409, errorBody('STATE_CONFLICT')) },
      tables: {
        reply_drafts: [
          {
            id: DRAFT,
            kind: 'reply',
            message_id: MESSAGE,
            thread_id: THREAD,
            connected_account_id: googleAccount.id,
            tone: 'professional',
            status: 'draft',
            body: 'Başka cihazda yazılan metin.',
            to_emails: ['mehmet@yilmaz.example'],
            cc_emails: [],
            subject: 'Re: Teklif',
            version: 4,
            attachments: [],
            approval_action_id: null,
            language: 'tr',
            warnings: [],
            created_at: TS,
            updated_at: TS,
          },
        ],
      },
    });
    await openReply();
    await fireEvent.changeText(
      screen.getByTestId('ui.draftEditorCard.input'),
      'Düzenlenmiş metin.',
    );
    expect(events('reply_draft_edit')).toHaveLength(1);
    const conflict = await screen.findByTestId('reply.conflict', {}, { timeout: 3000 });
    expect(calls(api, `/reply-drafts/${DRAFT}`)[0]?.body).toEqual({
      body_text: 'Düzenlenmiş metin.',
      expected_version: 1,
    });
    await fireEvent.press(within(conflict).getByText('Son Hali Yükle'));
    expect(await screen.findByDisplayValue('Başka cihazda yazılan metin.')).toBeOnTheScreen();
    expect(screen.queryByTestId('reply.conflict')).toBeNull();
  });

  it('shortens with an instruction; a failure toasts and a quota answer shows the limit', async () => {
    const { api } = replySetup({
      api: {
        [`POST /reply-drafts/${DRAFT}/regenerate`]: sequence(
          json(200, ok(draft({ body_text: 'Kısa metin.', version: 2 }))),
          json(500, errorBody('INTERNAL_ERROR')),
          json(429, errorBody('QUOTA_EXCEEDED')),
        ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByText('Kısalt'));
    expect(await screen.findByDisplayValue('Kısa metin.')).toBeOnTheScreen();
    expect(calls(api, '/regenerate')[0]?.body).toEqual({
      instructions: 'Yanıtı anlamını koruyarak kısalt.',
      expected_version: 1,
    });
    expect(await screen.findByText('Taslak kısaltıldı.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Kısalt'));
    await waitFor(() => {
      expect(calls(api, '/regenerate')).toHaveLength(2);
    });
    await fireEvent.press(screen.getByText('Kısalt'));
    expect(await screen.findByTestId('reply.budget')).toBeOnTheScreen();
    expect(events('reply_assist').map((e) => e.props.kind)).toEqual([
      'shorten',
      'shorten',
      'shorten',
    ]);
  });

  it('attaches a file: a wrong type and an oversize file are refused, a PDF is uploaded', async () => {
    const pick = jest.mocked(DocumentPicker.getDocumentAsync);
    const file = (mimeType: string, size: number) => ({
      canceled: false as const,
      assets: [
        { uri: 'file:///tmp/teklif.pdf', name: 'teklif.pdf', mimeType, size, lastModified: 0 },
      ],
    });
    pick
      .mockResolvedValueOnce(file('application/zip', 1000))
      .mockResolvedValueOnce(file('application/pdf', 4 * 1024 * 1024))
      .mockResolvedValueOnce(file('application/pdf', 1000));
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).startsWith('file:')
            ? new Response(new Uint8Array([37, 80, 68, 70]))
            : new Response(null, { status: 200 }),
        ),
      );
    const { api } = replySetup({
      api: {
        [`POST /reply-drafts/${DRAFT}/attachments/upload-url`]: () =>
          json(
            200,
            ok({
              upload: {
                signed_url: 'https://project-ref.supabase.test/storage/v1/upload/sign/x',
                token: 'upload-token',
                path: 'reply/teklif.pdf',
                expires_at: '2026-09-30T08:00:00Z',
              },
              draft: draft({
                attachments: [
                  {
                    storage_path: 'reply/teklif.pdf',
                    name: 'teklif.pdf',
                    mime: 'application/pdf',
                    size_bytes: 1000,
                  },
                ],
                version: 2,
              }),
            }),
          ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByText('Dosya Ekle'));
    expect(await screen.findByText('Bu dosya türü eklenemiyor.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Dosya Ekle'));
    expect(
      await screen.findByText('Ekler toplamda 3 MB sınırını aşıyor.', {}, { timeout: 5000 }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Dosya Ekle'));
    await waitFor(() => {
      expect(events('reply_assist').at(-1)?.props).toEqual({ kind: 'attach' });
    });
    expect(calls(api, '/attachments/upload-url')[0]?.body).toMatchObject({
      file_name: 'teklif.pdf',
      mime: 'application/pdf',
      size_bytes: 1000,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://project-ref.supabase.test/storage/v1/upload/sign/x',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(screen.getByText(/teklif\.pdf \(/)).toBeOnTheScreen();
    fetchSpy.mockRestore();
  }, 15_000);
});

describe('M-REPLY-01 · sending', () => {
  it('opens the approval sheet when the submitted draft differs from the one shown', async () => {
    const { api } = replySetup({
      api: {
        [`POST /reply-drafts/${DRAFT}/submit`]: () =>
          json(
            200,
            ok({
              draft: draft({ status: 'submitted', warnings: ['recipients_changed'] }),
              approval: emailApproval(),
            }),
          ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
    expect(calls(api, '/approve')).toHaveLength(0);
    expect(events('reply_submit')[0]?.props).toEqual({ mode: 'reply' });
  });

  it('explains submit failures: attachments too large, a conflict and a generic error', async () => {
    replySetup({
      api: {
        [`POST /reply-drafts/${DRAFT}/submit`]: sequence(
          json(413, errorBody('PAYLOAD_TOO_LARGE')),
          json(409, errorBody('STATE_CONFLICT')),
          json(500, errorBody('INTERNAL_ERROR')),
        ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(await screen.findByText('Ekler toplamda 3 MB sınırını aşıyor.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(await screen.findByTestId('reply.conflict')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(
      await screen.findByText('Mail gönderilemedi. Tekrar dene.', {}, { timeout: 6000 }),
    ).toBeOnTheScreen();
  }, 15_000);

  it('polls the approval after approve and shows the failure with a retry', async () => {
    const approvalRow = {
      id: APPROVAL,
      status: 'executing',
      last_error_code: null as string | null,
      payload_version: 1,
      idempotency_key: `approval:${APPROVAL}:v1`,
    };
    replySetup({
      api: { [`POST /approvals/${APPROVAL}/approve`]: () => approved('executing') },
      tables: { approval_actions: [approvalRow] },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(await screen.findByTestId('reply.sending')).toBeOnTheScreen();
    approvalRow.status = 'failed';
    approvalRow.last_error_code = 'PROVIDER_UNAVAILABLE';
    const failed = await screen.findByTestId('reply.failed', {}, { timeout: 5000 });
    expect(within(failed).getByText('Mail gönderilemedi.')).toBeOnTheScreen();
    expect(events('approval_executed').at(-1)?.props).toEqual({
      type: 'email_send',
      result: 'failed',
    });
  }, 15_000);

  it('returns to Today after sending from a Today card', async () => {
    replySetup();
    await openReply(`/mail/${MESSAGE}/reply?origin=today`);
    await fireEvent.press(screen.getByTestId('reply.approve'));
    const sent = await screen.findByTestId('reply.sent', {}, { timeout: 5000 });
    expect(within(sent).getByText('Yanıtın Mehmet Yılmaz kişisine gönderildi.')).toBeOnTheScreen();
    expect(events('approval_decided').at(-1)?.props).toMatchObject({
      action_type: 'email_send',
      decision: 'approved',
      via: 'in_place',
    });
  });

  it('edits a pending approval (approvalId → PATCH /approvals/:id) and approves the new version', async () => {
    const { api } = replySetup({
      tables: {
        approval_actions: [
          {
            id: EDITED,
            status: 'pending',
            payload: { reply_draft_id: DRAFT },
            payload_version: 1,
            idempotency_key: `approval:${EDITED}:v1`,
            action_type: 'email_send',
          },
        ],
        reply_drafts: [
          {
            id: DRAFT,
            kind: 'reply',
            message_id: MESSAGE,
            thread_id: THREAD,
            connected_account_id: googleAccount.id,
            tone: 'professional',
            status: 'submitted',
            body: 'Onay bekleyen metin.',
            to_emails: ['mehmet@yilmaz.example'],
            cc_emails: [],
            subject: 'Re: Teklif',
            version: 2,
            attachments: [],
            approval_action_id: EDITED,
            language: 'tr',
            warnings: [],
            created_at: TS,
            updated_at: TS,
          },
        ],
      },
      api: {
        [`PATCH /approvals/${EDITED}`]: () =>
          json(
            200,
            ok(
              emailApproval({
                id: EDITED,
                payload_version: 2,
                idempotency_key: `approval:${EDITED}:v2`,
              }),
            ),
          ),
        [`POST /approvals/${EDITED}/approve`]: () => approved('executed'),
      },
    });
    // Opened in-app from the Approval Center ("Düzenle"); deep links never carry an approval id.
    await openFrom('/flow', 'flow.screen', `/mail/${MESSAGE}/reply?approvalId=${EDITED}`);
    expect(await screen.findByDisplayValue('Onay bekleyen metin.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    await waitFor(() => {
      expect(calls(api, `/approvals/${EDITED}/approve`)).toHaveLength(1);
    });
    expect(calls(api, `/approvals/${EDITED}`)[0]?.body).toEqual({
      expected_payload_version: 1,
      payload_patch: { body_text: 'Onay bekleyen metin.', subject: 'Re: Teklif' },
    });
    expect(calls(api, `/approvals/${EDITED}/approve`)[0]?.body).toEqual({
      idempotency_key: `approval:${EDITED}:v2`,
      payload_version: 2,
      approved_via: 'in_place',
    });
    expect(calls(api, '/submit')).toHaveLength(0);
  });
});

describe('M-REPLY-02 · gönderim izni', () => {
  const COMPLETION = 'C0mpletionCode_xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const grantedUrl =
    'dijitalasistan://integrations/callback?provider=google&result=pending_confirmation&completion_code=' +
    COMPLETION;

  it('asks for mail_send before submitting and sends after the grant', async () => {
    jest
      .mocked(WebBrowser.openAuthSessionAsync)
      .mockResolvedValueOnce({ type: 'success', url: grantedUrl });
    const { api } = replySetup({
      accounts: [googleAccount],
      api: {
        [`POST /integrations/${googleAccount.id}/upgrade`]: () =>
          json(
            200,
            ok({
              already_granted: false,
              state_id: uuid(1010),
              auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
              state_expires_at: '2026-09-24T07:00:00Z',
              missing_scopes: ['gmail.send'],
            }),
          ),
        'POST /integrations/oauth/complete': () =>
          json(
            200,
            ok({
              result: 'success',
              account: sendAccount,
              granted: ['mail_send'],
              missing: [],
              resume: null,
              jobs: [],
            }),
          ),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    const sheet = await screen.findByTestId('m2.scope');
    expect(within(sheet).getByText('Gönderim izni gerekli')).toBeOnTheScreen();
    expect(events('scope_upgrade_view')[0]?.props).toEqual({
      capability: 'mail_send',
      provider: 'google',
    });
    expect(calls(api, '/submit')).toHaveLength(0);
    await fireEvent.press(within(sheet).getByTestId('m2.scope.allow'));
    await waitFor(() => {
      expect(events('scope_upgrade_result').at(-1)?.props).toEqual({
        capability: 'mail_send',
        result: 'granted',
      });
    });
    expect(calls(api, '/upgrade')[0]?.body).toMatchObject({ capability: 'mail_send' });
    expect(calls(api, '/oauth/complete')[0]?.body).toMatchObject({
      completion_code: COMPLETION,
    });
    // The pending send resumes once the scope is granted.
    await waitFor(() => {
      expect(calls(api, '/submit')).toHaveLength(1);
    });
    expect(await screen.findByTestId('reply.sent', {}, { timeout: 5000 })).toBeOnTheScreen();
  });

  it('keeps the draft when the grant is denied or the browser is closed', async () => {
    jest
      .mocked(WebBrowser.openAuthSessionAsync)
      .mockResolvedValueOnce({
        type: 'success',
        url: 'dijitalasistan://integrations/callback?provider=google&result=denied',
      })
      .mockResolvedValueOnce({ type: 'cancel' } as AuthSessionResult);
    const upgrade = {
      already_granted: false,
      state_id: uuid(1010),
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
      state_expires_at: '2026-09-24T07:00:00Z',
      missing_scopes: ['gmail.send'],
    };
    const { api } = replySetup({
      accounts: [googleAccount],
      api: {
        [`POST /integrations/${googleAccount.id}/upgrade`]: () => json(200, ok(upgrade)),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    await fireEvent.press(await screen.findByTestId('m2.scope.allow'));
    expect(await screen.findByTestId('m2.scope.outcome')).toHaveTextContent(
      'İzin verilmedi. Mail gönderilmedi; taslağın kaydedildi.',
    );
    await fireEvent.press(screen.getByTestId('m2.scope.allow'));
    await waitFor(() => {
      expect(events('send_scope_upgrade_result').at(-1)?.props).toEqual({ result: 'cancelled' });
    });
    expect(calls(api, '/submit')).toHaveLength(0);
  });

  it('resumes an approve that answered PROVIDER_SCOPE_MISSING with the same key', async () => {
    const { api } = replySetup({
      api: {
        [`POST /approvals/${APPROVAL}/approve`]: sequence(
          json(424, errorBody('PROVIDER_SCOPE_MISSING')),
          approved('executed'),
        ),
        [`POST /integrations/${googleAccount.id}/upgrade`]: () =>
          json(200, ok({ already_granted: true })),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    await fireEvent.press(await screen.findByTestId('m2.scope.allow'));
    expect(await screen.findByTestId('reply.sent', {}, { timeout: 5000 })).toBeOnTheScreen();
    const approves = calls(api, '/approve');
    expect(approves).toHaveLength(2);
    expect(approves[0]?.headers['idempotency-key']).toBe(approves[1]?.headers['idempotency-key']);
    expect(calls(api, '/upgrade')[0]?.body).toMatchObject({
      capability: 'mail_send',
      resume: { approval_id: APPROVAL },
    });
  });

  it('toasts a failed approve without sending', async () => {
    replySetup({
      api: {
        [`POST /approvals/${APPROVAL}/approve`]: () => json(500, errorBody('INTERNAL_ERROR')),
      },
    });
    await openReply();
    await fireEvent.press(screen.getByTestId('reply.approve'));
    expect(await screen.findByText('Mail gönderilemedi. Tekrar dene.')).toBeOnTheScreen();
    expect(screen.getByTestId('reply.approve')).toBeOnTheScreen();
  });
});

describe('M-REPLY-01 · closing and hand-off', () => {
  it('keeps an edited draft on close ("Taslağı Sakla") and saves it first', async () => {
    const { api } = replySetup();
    const { router } = await openFrom('/flow', 'flow.screen', `/mail/${MESSAGE}/reply`);
    await screen.findByTestId('ui.draftEditorCard.input');
    await fireEvent.changeText(screen.getByTestId('ui.draftEditorCard.input'), 'Saklanacak metin.');
    await fireEvent.press(screen.getByLabelText('Kapat'));
    expect(await screen.findByText('Taslak saklansın mı?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('m2.menu.keep'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/flow');
    });
    expect(calls(api, `/reply-drafts/${DRAFT}`).find((c) => c.method === 'PATCH')?.body).toEqual({
      body_text: 'Saklanacak metin.',
      expected_version: 1,
    });
    expect(await screen.findByText('Taslak saklandı')).toBeOnTheScreen();
    expect(events('reply_draft_close').at(-1)?.props).toEqual({ kept: true });
  });

  it('opens the reply in Gmail from "···" and shows the Outlook limit for Microsoft accounts', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    replySetup();
    await openReply();
    await fireEvent.press(screen.getByLabelText('Diğer seçenekler'));
    await fireEvent.press(await screen.findByTestId('m2.menu.handoff'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(expect.stringContaining('mail.google.com'));
    });
    expect(screen.getByText(/ah\*\*\*@example\.com · Gmail/)).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(
      await screen.findByText('Çevrimdışısın. Gönderim için bağlantı gerekiyor.'),
    ).toBeOnTheScreen();
  });

  it('shows the Outlook attachment limit for a Microsoft draft', async () => {
    const outlook = { ...sendAccount, id: uuid(11), provider: 'microsoft' as const };
    replySetup({
      accounts: [outlook],
      api: {
        [`POST /mail/${MESSAGE}/reply-drafts`]: () =>
          json(201, ok(draft({ connected_account_id: uuid(11) }))),
      },
    });
    await openReply();
    expect(
      screen.getByText('Outlook yanıtlarında ekler toplam 3 MB ile sınırlı.'),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Outlook$/)).toBeOnTheScreen();
  });
});
