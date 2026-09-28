/**
 * T-8.15 · M-ASST-02 Sohbet (SCREEN_AND_FLOW_MAP M-ASST-02, API_CONTRACTS API-AST-02 SSE): a stored
 * person-scoped thread (history, stored approvals, follow-ups, answer feedback written to
 * `ai_feedback`), the stream's verifying / refused-ungrounded / cancelled / error events (AI
 * unavailable, AI limit → paywall, rate limit, failure → retry with the same client message id),
 * the empty state's suggestions, "Yeni sohbet", the composer hand-offs (voice, capture) and a
 * missing thread.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { json, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { M3, approvalRow, sse } from '../helpers/assist';
import { errorBody, ok, TS, uuid } from '../helpers/fixtures';
import { events, openApp } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { back } from './support';

const THREAD = M3.thread;
const MESSAGES = `POST /assistant/threads/${THREAD}/messages`;

const meta = [
  'meta',
  {
    thread_id: THREAD,
    user_message_id: M3.userMessage,
    assistant_message_id: M3.message,
    correlation_id: 'corr-12345678',
  },
] as const;

const done = (finish: string, grounded = true) =>
  [
    'done',
    {
      assistant_message_id: M3.message,
      finish_reason: finish,
      grounded,
      usage: { remaining_messages: 10 },
    },
  ] as const;

const errorEvent = (code: string) =>
  [
    'error',
    {
      code,
      message: code,
      message_key: `errors.${code.toLowerCase()}`,
      retryable: false,
      correlation_id: 'corr-1',
    },
  ] as const;

function storedThread(db: PostgrestFake) {
  db.setTable('assistant_threads', [
    {
      id: THREAD,
      title: 'Teklif durumu',
      scope: 'person',
      scope_ref_id: M3.contact,
      archived_at: null,
    },
  ]);
  db.setTable('contacts', [{ id: M3.contact, display_name: 'Mehmet Yılmaz' }]);
  db.setTable('assistant_messages', [
    {
      id: uuid(2600),
      thread_id: THREAD,
      role: 'user',
      content: 'Teklif ne durumda?',
      status: 'complete',
      citations: [],
      cards: [],
      proposed_approval_ids: [],
      followup_suggestions: [],
      grounded: false,
      finish_reason: null,
      created_at: TS,
    },
    {
      id: uuid(2601),
      thread_id: THREAD,
      role: 'assistant',
      content: 'Mehmet teklife dönmedi.',
      status: 'cancelled',
      citations: [
        {
          index: 0,
          source: {
            source_type: 'email_message',
            source_id: uuid(2602),
            source_provider: 'google',
            source_timestamp: TS,
          },
          title: 'Teklif v2',
          snippet: 'Fiyat',
        },
      ],
      cards: [],
      proposed_approval_ids: [M3.approval],
      followup_suggestions: ['Hatırlatıcı kur'],
      grounded: true,
      finish_reason: 'stop',
      created_at: TS,
    },
  ]);
  db.setTable('approval_actions', [approvalRow()]);
}

function openThread(routes: Record<string, Responder> = {}) {
  return openApp({ path: `/chat/${THREAD}`, setup: storedThread, routes });
}

function openNew(routes: Record<string, Responder>, path = '/chat/new') {
  return openApp({
    path,
    setup: (db) => {
      db.setTable('assistant_threads', [
        { id: THREAD, title: null, scope: 'global', scope_ref_id: null, archived_at: null },
      ]);
    },
    routes: {
      'POST /assistant/threads': () =>
        json(201, ok({ id: THREAD, scope: { type: 'global' }, created_at: TS })),
      ...routes,
    },
  });
}

async function ask(text: string) {
  await fireEvent.changeText(await screen.findByTestId('ui.chatComposer.input'), text);
  await fireEvent.press(screen.getByTestId('ui.chatComposer.send'));
}

const messageCalls = (calls: readonly RecordedCall[]) =>
  calls.filter((c) => c.url.endsWith(`/threads/${THREAD}/messages`));

beforeEach(async () => {
  await resetAppState();
});

describe('M-ASST-02 · stored thread', () => {
  it('shows the person-scoped history with its approval, and records answer feedback', async () => {
    const { db } = await openThread();
    expect(await screen.findByText('Mehmet teklife dönmedi.')).toBeOnTheScreen();
    expect(screen.getByText('Mehmet Yılmaz hakkında'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.getByText('Teklif ne durumda?')).toBeOnTheScreen();
    expect(screen.getByText('Durduruldu')).toBeOnTheScreen();
    expect(await screen.findByTestId(`stored.approval.${M3.approval}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`chat.feedback.${uuid(2601)}.negative`));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'ai_feedback')?.values).toEqual({
        target_type: 'assistant_message',
        target_id: uuid(2601),
        rating: -1,
        reason_code: 'inaccurate',
      });
    });
    expect(await screen.findByText('Teşekkürler · Öğrendim')).toBeOnTheScreen();
    expect(events('assistant_answer_feedback').at(-1)?.props).toEqual({ rating: 'down' });
  });

  it('sends a follow-up suggestion into the same thread', async () => {
    const { api } = await openThread({
      [MESSAGES]: () =>
        sse([meta, ['delta', { text: 'Yarın 09:00 için kurabilirim.' }], done('stop')]),
    });
    await fireEvent.press(await screen.findByText('Hatırlatıcı kur'));
    expect(await screen.findByText('Yarın 09:00 için kurabilirim.')).toBeOnTheScreen();
    expect(messageCalls(api.calls)[0]?.body).toMatchObject({
      content: 'Hatırlatıcı kur',
      input_mode: 'text',
      context: { screen: 'M-ASST-02' },
    });
    expect(events('assistant_query_sent').at(-1)?.props).toMatchObject({ scoped: true });
  });

  it('hands off to voice and capture', async () => {
    const { router } = await openThread();
    await fireEvent.press(await screen.findByTestId('ui.chatComposer.mic'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/voice');
    });
    expect(router.getSearchParams()).toMatchObject({ origin: 'assistant', threadId: THREAD });
    await back();
    await fireEvent.press(await screen.findByLabelText('Ekle'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/capture');
    });
    expect(events('assistant_capture_opened')).toHaveLength(1);
  });

  it('starts a new chat that keeps the person scope', async () => {
    const { router, api } = await openThread({
      'POST /assistant/threads': () =>
        json(
          201,
          ok({ id: uuid(2604), scope: { type: 'person', contact_id: M3.contact }, created_at: TS }),
        ),
      [`POST /assistant/threads/${uuid(2604)}/messages`]: () =>
        sse([meta, ['delta', { text: 'Tamam.' }], done('stop')]),
    });
    await screen.findByText('Mehmet Yılmaz hakkında'.toLocaleUpperCase('tr-TR'));
    await fireEvent.press(screen.getByTestId('chat.new'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/chat/new');
    });
    await ask('Son durum?');
    await waitFor(() => {
      expect(api.calls.find((c) => c.url.endsWith('/assistant/threads'))?.body).toMatchObject({
        scope: { type: 'person', contact_id: M3.contact },
      });
    });
  });

  it('shows not-found for a missing thread', async () => {
    const { router } = await openApp({ path: `/chat/${uuid(2603)}` });
    expect(await screen.findByTestId('chat.notFound')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Geri Dön'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
  });
});

describe('M-ASST-02 · live answer states', () => {
  it('suggests memory or rephrasing when the answer is not grounded', async () => {
    const { router } = await openNew({
      [MESSAGES]: () =>
        sse([
          meta,
          ['status', { stage: 'verifying' }],
          ['delta', { text: 'Kaynaklarında bulamadım.' }],
          done('refused_ungrounded', false),
        ]),
    });
    await ask('Uçuşum ne zaman?');
    expect(await screen.findByTestId('chat.noAnswer.rephrase')).toBeOnTheScreen();
    expect(events('assistant_answer_completed').at(-1)?.props).toMatchObject({
      grounded: false,
      no_answer: true,
    });
    await fireEvent.press(screen.getByTestId('chat.noAnswer.rephrase'));
    expect(screen.getByTestId('ui.chatComposer.input')).toHaveProp('value', 'Uçuşum ne zaman?');
    await fireEvent.press(screen.getByTestId('chat.noAnswer.memory'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/memory');
    });
    expect(router.getSearchParams()).toMatchObject({ q: 'Uçuşum ne zaman?' });
  });

  it('marks a client-disconnected answer as stopped', async () => {
    await openNew({
      [MESSAGES]: () =>
        sse([meta, ['delta', { text: 'Yarım yanıt' }], done('client_disconnected')]),
    });
    await ask('Bugün ne var?');
    expect(await screen.findByText('Durduruldu')).toBeOnTheScreen();
  });

  it.each([
    ['AI_UNAVAILABLE', 'chat.aiUnavailable'],
    ['QUOTA_EXCEEDED', 'chat.aiLimit'],
    ['RATE_LIMITED', 'chat.error'],
    ['INTERNAL_ERROR', 'chat.error'],
  ])('shows the %s stream error', async (code, testID) => {
    await openNew({ [MESSAGES]: () => sse([meta, errorEvent(code)]) });
    await ask('Bugün ne var?');
    expect(await screen.findByTestId(testID)).toBeOnTheScreen();
    expect(events('assistant_stream_error').at(-1)?.props).toEqual({ code });
  });

  it('opens the paywall from the AI limit card', async () => {
    const { router } = await openNew({
      [MESSAGES]: () => sse([meta, errorEvent('QUOTA_EXCEEDED')]),
    });
    await ask('Bugün ne var?');
    await fireEvent.press(within(await screen.findByTestId('chat.aiLimit')).getByRole('button'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/paywall');
    });
  });

  it('retries a failed request with the same client message id and explains a rate limit', async () => {
    let n = 0;
    const { api } = await openNew({
      [MESSAGES]: () => {
        n += 1;
        return n === 1
          ? json(429, errorBody('RATE_LIMITED', true))
          : sse([meta, ['delta', { text: 'Tamam.' }], done('stop')]);
      },
    });
    await ask('Bugün ne var?');
    expect(await screen.findByText(/Çok hızlı soruyorsun\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('chat.retry'));
    expect(await screen.findByText('Tamam.')).toBeOnTheScreen();
    const [first, second] = messageCalls(api.calls);
    expect((second?.body as { client_message_id?: string } | undefined)?.client_message_id).toBe(
      (first?.body as { client_message_id?: string } | undefined)?.client_message_id,
    );
  });

  it('sends an empty-state suggestion with its prompt key', async () => {
    await openNew({
      [MESSAGES]: () => sse([meta, ['delta', { text: 'Odak: teklif.' }], done('stop')]),
    });
    const empty = await screen.findByTestId('chat.empty');
    await fireEvent.press(within(empty).getAllByRole('button')[0] ?? empty);
    expect(await screen.findByText('Odak: teklif.')).toBeOnTheScreen();
    expect(events('assistant_query_sent').at(-1)?.props).toMatchObject({ suggested: true });
  });
});
