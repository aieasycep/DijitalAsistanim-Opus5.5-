/**
 * T-8.15 Voice (M-VOICE-01): on-device recognition sends the question with `input_mode: voice`,
 * a spoken "onayla" never approves (R-03 / C-07: the user is told to tap), and a tap on the
 * compact card approves with `approved_via: voice_card`; "Brifingimi oku" is Pro-gated on Free.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { isBriefingIntent, isSpokenApproval } from '../src/features/voice/VoiceScreen';
import { json, resetAppState } from './helpers/app';
import { M3, answerStream, approveResponse } from './helpers/assist';
import { TS, ok } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

type Handler = (event: unknown) => void;
const handlers = new Map<string, Handler>();

beforeEach(async () => {
  await resetAppState();
  handlers.clear();
  jest.mocked(useSpeechRecognitionEvent).mockImplementation(((name: string, handler: Handler) => {
    handlers.set(name, handler);
  }) as never);
});

async function say(text: string) {
  const starts = () => jest.mocked(ExpoSpeechRecognitionModule).start.mock.calls.length;
  const before = starts();
  await fireEvent.press(screen.getByTestId('voice.orb'));
  await waitFor(() => {
    expect(starts()).toBeGreaterThan(before);
  });
  await act(async () => {
    handlers.get('result')?.({ results: [{ transcript: text }], isFinal: true });
    handlers.get('end')?.({});
    await Promise.resolve();
  });
}

describe('voice intents', () => {
  it('recognises a spoken approval and the briefing request deterministically', () => {
    expect(isSpokenApproval('Onayla.')).toBe(true);
    expect(isSpokenApproval('onayla bunu yarın')).toBe(false);
    expect(isBriefingIntent('Brifingimi oku')).toBe(true);
  });
});

describe('Voice (M-VOICE-01)', () => {
  it('asks by voice, refuses a spoken approval and approves only on tap', async () => {
    const { api } = await openApp({
      path: '/voice?origin=assistant',
      routes: {
        'POST /assistant/threads': () =>
          json(201, ok({ id: M3.thread, scope: { type: 'global' }, created_at: TS })),
        [`POST /assistant/threads/${M3.thread}/messages`]: () =>
          answerStream({ text: 'Yarın 08:00 için hatırlatıcı hazırladım.', approval: {} }),
        [`POST /approvals/${M3.approval}/approve`]: () =>
          json(202, ok(approveResponse({ status: 'executing', approved_via: 'voice_card' }))),
      },
    });
    await screen.findByTestId('screen.voice');
    await say('Yarın sabah faturayı hatırlat');
    const card = await screen.findByTestId(`voice.parts.approval.${M3.approval}`);
    expect(api.calls.find((c) => c.url.endsWith('/messages'))?.body).toMatchObject({
      content: 'Yarın sabah faturayı hatırlat',
      input_mode: 'voice',
    });

    await say('Onayla');
    expect(await screen.findByText("Onaylamak için ekrandaki Onayla'ya dokun.")).toBeOnTheScreen();
    expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(false);
    expect(events('voice_intent').map((e) => e.props.kind)).toEqual(['question', 'action']);

    await fireEvent.press(within(card).getByText('Onayla'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/approve'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/approve'))?.body).toMatchObject({
      approved_via: 'voice_card',
    });
  });

  it('gates "Brifingimi oku" behind Pro on Free', async () => {
    await openApp({ path: '/voice?origin=today' });
    await screen.findByTestId('screen.voice');
    await say('Brifingimi oku');
    expect(await screen.findByTestId('voice.briefingGate')).toBeOnTheScreen();
    expect(events('voice_intent')[0]?.props).toEqual({ kind: 'briefing' });
  });
});
