/**
 * T-8.15 Assistant home and chat (M-ASST-01/02): suggested prompts, recent threads with delete,
 * the SSE answer (text, sources, an action proposal approved in place with `approved_via:
 * in_place`) and the offline composer.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';

import { json, resetAppState } from './helpers/app';
import { M3, answerStream, approveResponse } from './helpers/assist';
import { TS, ok } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

beforeEach(async () => {
  await resetAppState();
});

describe('Assistant home (M-ASST-01)', () => {
  it('shows suggested prompts and deletes a recent thread after confirmation', async () => {
    const { db } = await openApp({
      path: '/assistant',
      setup: (fake) => {
        fake.setTable('assistant_threads', [
          {
            id: M3.thread,
            title: 'Teklif durumu',
            last_message_at: TS,
            scope: 'global',
            scope_ref_id: null,
          },
        ]);
      },
    });
    expect(await screen.findByTestId('assistant.prompt.focus')).toBeOnTheScreen();
    expect(await screen.findByText('Teklif durumu')).toBeOnTheScreen();
    expect(events('assistant_opened')[0]?.props).toEqual({ has_threads: true });

    await fireEvent(screen.getByLabelText('Teklif durumu'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    const dialog = await screen.findByTestId('assistant.deleteConfirm');
    expect(within(dialog).getByText('Sohbet silinsin mi?')).toBeOnTheScreen();
    await fireEvent.press(within(dialog).getByText('Sil'));
    await waitFor(() => {
      expect(db.writes.some((w) => w.table === 'assistant_threads' && w.op === 'delete')).toBe(
        true,
      );
    });
    expect(events('assistant_thread_deleted')).toHaveLength(1);
  });

  it('disables the composer offline', async () => {
    await openApp({ path: '/assistant' });
    await screen.findByTestId('screen.assistant');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('assistant.offline')).toBeOnTheScreen();
    expect(screen.getByTestId('ui.chatComposer.input')).toHaveProp('editable', false);
  });
});

describe('Chat (M-ASST-02)', () => {
  it('streams a sourced answer and approves the proposal in place', async () => {
    const { api } = await openApp({
      path: '/chat/new?prompt=focus&origin=assistant',
      setup: (db) => {
        db.setTable('approval_actions', []);
      },
      routes: {
        'POST /assistant/threads': () =>
          json(201, ok({ id: M3.thread, scope: { type: 'global' }, created_at: TS })),
        [`POST /assistant/threads/${M3.thread}/messages`]: () =>
          answerStream({ text: 'Bugün 2 konu öne çıkıyor.', approval: {} }),
        [`POST /approvals/${M3.approval}/approve`]: () =>
          json(202, ok(approveResponse({ status: 'executing', approved_via: 'in_place' }))),
      },
    });
    expect(await screen.findByText('Bugün 2 konu öne çıkıyor.')).toBeOnTheScreen();
    const message = api.calls.find((c) => c.url.endsWith(`/threads/${M3.thread}/messages`));
    expect(message?.body).toMatchObject({
      content: 'Bugün neye odaklanmalıyım?',
      input_mode: 'text',
      context: { screen: 'M-ASST-02' },
    });
    expect(events('assistant_query_sent')[0]?.props).toEqual({
      suggested: true,
      prompt_key: 'focus',
      input_mode: 'text',
      scoped: false,
    });
    const card = await screen.findByTestId(`chat.live.approval.${M3.approval}`);
    expect(within(card).getByText('Faturayı öde')).toBeOnTheScreen();
    await fireEvent.press(within(card).getByText('Onayla'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/approve'))?.body).toMatchObject({
      approved_via: 'in_place',
    });
  });
});
