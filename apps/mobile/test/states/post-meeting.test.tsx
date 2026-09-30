/**
 * T-8.14 · M-MEET-04 Toplantı Sonrası and M-MEET-05 Taahhüdü Düzenle (SCREEN_AND_FLOW_MAP M-MEET-04/05,
 * API_CONTRACTS `POST /meetings/:eventId/post`, `PATCH /approvals/:id`): the Free gate, dictation
 * that never starts on its own (partial → final transcript, denial, recognition error), extraction
 * with `source: voice`, the idempotent retry, the AI-limit and offline states, the edit sheet
 * (empty text, no-op, patch body, conflict), a failed row on "Kaydet", the saved state, discarding
 * with `user_cancel` and "Notu Sil" for a note with no commitments.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Linking } from 'react-native';

import { postDraftKey } from '../../src/features/meeting/PostMeetingScreen';
import { readDraft } from '../../src/features/meeting/dictation';
import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { errorBody, ok, uuid } from '../helpers/fixtures';
import { approved, commitmentApproval, events, setup } from '../m2/harness';
import { appRouter, nth, sequence } from './support';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T10:00:00Z'),
}));

type Handler = (event: unknown) => void;
const speech = jest.mocked(ExpoSpeechRecognitionModule);
const handlers = new Map<string, Handler>();

const EVENT = uuid(2100);
const NOTE = uuid(2101);
const A = uuid(2110);
const B = uuid(2111);

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    title: 'Müşteri toplantısı',
    start_at: '2026-09-24T08:00:00Z',
    end_at: '2026-09-24T09:00:00Z',
    all_day: false,
    location: null,
    conference_url: null,
    attendees: [
      { name: 'Ahmet', email: 'ahmet@example.com', response: 'accepted', is_self: true },
      { name: 'Mehmet Yılmaz', email: 'mehmet@example.com', response: 'accepted' },
    ],
    attendee_count: 2,
    organizer_self: true,
    can_modify: true,
    description_excerpt: null,
    provider: 'google',
    calendar_id: uuid(12),
    connected_account_id: uuid(10),
    da_approval_id: null,
    status: 'confirmed',
    provider_updated_at: null,
    device_last_synced_at: null,
    ...overrides,
  };
}

function proposal(id: number, overrides: Record<string, unknown> = {}) {
  return {
    approval: commitmentApproval(id),
    text: 'Mehmet’e teklif gönder',
    counterparty_label: 'Mehmet Yılmaz',
    due_at: '2026-09-25T20:59:00Z',
    due_text: 'yarın',
    direction: 'user_owes',
    confidence: 0.92,
    quote: 'yarın teklif göndereceğim',
    ...overrides,
  };
}

const extracted = (proposals: readonly unknown[], noneFound = false) =>
  json(201, ok({ note_id: NOTE, none_found: noneFound, proposals }));

function postSetup(api: Readonly<Record<string, Responder>>, pro = true, row = eventRow()) {
  return setup({ pro, data: { tables: { calendar_events: [row], meeting_notes: [] } }, api });
}

async function openPost() {
  const rendered = await renderApp(`/meeting/${EVENT}/post`);
  await screen.findByTestId('post.screen');
  return rendered;
}

async function typeNote(text: string) {
  await fireEvent.press(await screen.findByTestId('post.modeToggle'));
  await fireEvent.changeText(screen.getByTestId('post.input'), text);
}

const postCalls = (calls: readonly RecordedCall[]) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith(`/meetings/${EVENT}/post`));

beforeEach(async () => {
  await resetAppState();
  handlers.clear();
  speech.start.mockClear();
  jest.mocked(useSpeechRecognitionEvent).mockImplementation(((name: string, handler: Handler) => {
    handlers.set(name, handler);
  }) as never);
});

describe('M-MEET-04 · Toplantı Sonrası', () => {
  it('shows the Pro gate on Free', async () => {
    postSetup({}, false);
    await openPost();
    expect(screen.getByText('Toplantı sonrası takip Pro ile gelir.')).toBeOnTheScreen();
    expect(screen.queryByTestId('post.extract')).toBeNull();
  });

  it('dictates on tap only, shows the partial transcript and extracts with source voice', async () => {
    const { api, fake } = postSetup({
      [`POST /meetings/${EVENT}/post`]: () => extracted([], true),
    });
    await openPost();
    expect(await screen.findByText(/^Mehmet Yılmaz · /)).toBeOnTheScreen();
    expect(events('post_meeting_opened').at(-1)?.props).toEqual({
      origin: 'deeplink',
      hours_since_end_bucket: '1-4',
    });
    expect(speech.start.mock.calls).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('post.mic'));
    await waitFor(() => {
      expect(speech.start.mock.calls.at(-1)?.[0]).toMatchObject({
        lang: 'tr-TR',
        interimResults: true,
      });
    });
    await act(async () => {
      handlers.get('start')?.({});
      handlers.get('result')?.({
        results: [{ transcript: 'Mehmet’e yarın', confidence: -1 }],
        isFinal: false,
      });
      await Promise.resolve();
    });
    expect(screen.getByText('Mehmet’e yarın')).toBeOnTheScreen();
    expect(screen.getByLabelText('Kaydı durdur')).toBeOnTheScreen();
    await act(async () => {
      handlers.get('result')?.({
        results: [{ transcript: 'Mehmet’e yarın teklif göndereceğim.', confidence: 0.9 }],
        isFinal: true,
      });
      handlers.get('end')?.({});
      await Promise.resolve();
    });
    expect(await screen.findByTestId('post.recordAgain')).toBeOnTheScreen();
    expect(events('speech_input_used').at(-1)?.props).toEqual({
      engine: 'on_device',
      success: true,
    });
    await fireEvent.press(screen.getByTestId('post.extract'));
    expect(await screen.findByTestId('post.none')).toBeOnTheScreen();
    expect(postCalls(api.calls)[0]?.body).toMatchObject({
      text: 'Mehmet’e yarın teklif göndereceğim.',
      source: 'voice',
    });
    expect(events('post_meeting_input').at(-1)?.props).toEqual({
      mode: 'voice',
      engine: 'on_device',
    });
    expect(events('post_meeting_extracted').at(-1)?.props).toEqual({
      count_bucket: '0',
      low_confidence_count: 0,
    });
    await fireEvent.press(screen.getByTestId('post.deleteNote'));
    await waitFor(() => {
      expect(fake.data.calls.some((c) => c.kind === 'delete' && c.target === 'meeting_notes')).toBe(
        true,
      );
    });
  });

  it('falls back to typing when the microphone is denied', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings');
    speech.requestPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    } as never);
    postSetup({});
    await openPost();
    await fireEvent.press(screen.getByTestId('post.mic'));
    expect(
      await screen.findByText('Mikrofon izni kapalı. Yazarak ekleyebilirsin.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('post.input')).toBeOnTheScreen();
    expect(screen.queryByTestId('post.mic')).toBeNull();
    await fireEvent.press(screen.getByText('Ayarları Aç'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('explains a recognition error and keeps typing available', async () => {
    postSetup({});
    await openPost();
    await fireEvent.press(screen.getByTestId('post.mic'));
    await waitFor(() => {
      expect(speech.start.mock.calls.length).toBeGreaterThan(0);
    });
    await act(async () => {
      handlers.get('error')?.({ error: 'network' });
      await Promise.resolve();
    });
    expect(await screen.findByText('Ses tanınamadı. Yazarak devam edebilirsin.')).toBeOnTheScreen();
    expect(events('speech_input_used').at(-1)?.props).toEqual({
      engine: 'on_device',
      success: false,
    });
  });

  it('retries a failed extraction with the same client_post_id, then shows the AI limit', async () => {
    const { api } = postSetup({
      [`POST /meetings/${EVENT}/post`]: sequence(
        json(422, errorBody('VALIDATION_FAILED')),
        json(429, errorBody('QUOTA_EXCEEDED')),
      ),
    });
    await openPost();
    await typeNote('Teklif göndereceğim.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    expect(await screen.findByTestId('post.extractFailed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Tekrar Dene'));
    expect(await screen.findByTestId('post.limit')).toBeOnTheScreen();
    const [first, second] = postCalls(api.calls);
    expect(first?.body).toMatchObject({ text: 'Teklif göndereceğim.', source: 'text' });
    expect((second?.body as { client_post_id?: string } | undefined)?.client_post_id).toBe(
      (first?.body as { client_post_id?: string } | undefined)?.client_post_id,
    );
  });

  it('keeps the note offline and restores the draft when reopened', async () => {
    const { api } = postSetup({});
    const { router } = await openPost();
    await typeNote('Hukuk sözleşmeye bakacak.');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(
      screen.getAllByText('Bağlantı gelince taahhütleri çıkarabilirim.').length,
    ).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('post.extract'));
    expect(postCalls(api.calls)).toHaveLength(0);
    expect(readDraft(postDraftKey(EVENT))).toBe('Hukuk sözleşmeye bakacak.');
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    await fireEvent.press(nth(screen.getAllByTestId('ui.detailHeader.leading'), -1));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    await act(async () => {
      appRouter.push(`/meeting/${EVENT}/post`);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('post.input')).toHaveProp(
      'value',
      'Hukuk sözleşmeye bakacak.',
    );
    expect(screen.getByTestId('post.recordAgain')).toBeOnTheScreen();
  });

  it('names the day for a meeting that ended more than a day ago', async () => {
    postSetup(
      {},
      true,
      eventRow({ start_at: '2026-09-23T06:00:00Z', end_at: '2026-09-23T07:00:00Z' }),
    );
    await openPost();
    expect(await screen.findByText(/^Mehmet Yılmaz · Dün /)).toBeOnTheScreen();
    expect(events('post_meeting_opened').at(-1)?.props).toMatchObject({
      hours_since_end_bucket: '>24',
    });
  });
});

describe('M-MEET-05 · Taahhüdü Düzenle and saving', () => {
  it('edits a proposal (empty text, no-op, patch body) and selects it', async () => {
    const { api } = postSetup({
      [`POST /meetings/${EVENT}/post`]: () =>
        extracted([
          proposal(2110),
          proposal(2111, {
            text: 'Hukuk sözleşmeyi okuyacak',
            counterparty_label: 'Hukuk ekibi',
            direction: 'they_owe',
            due_at: null,
            due_text: 'haftaya',
            confidence: 0.5,
          }),
        ]),
      [`PATCH /approvals/${B}`]: () =>
        json(200, ok(commitmentApproval(2111, { payload_version: 2 }))),
    });
    await openPost();
    await typeNote('Teklif ve sözleşme.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    expect(await screen.findByText('2 yeni taahhüt'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.getByText(/Tarih belirsiz · seç/)).toBeOnTheScreen();
    expect(screen.getByText(/Hukuk ekibi yapacak · Emin değilim, kontrol et/)).toBeOnTheScreen();
    expect(screen.getByTestId(`post.proposal.${A}.toggle`)).toBeChecked();
    expect(screen.getByTestId(`post.proposal.${B}.toggle`)).not.toBeChecked();

    // No change closes the sheet without a request.
    await fireEvent.press(screen.getByTestId(`post.proposal.${B}.edit`));
    await fireEvent.press(await screen.findByTestId('post.edit.save'));
    await waitFor(() => {
      expect(screen.queryByTestId('post.edit')).toBeNull();
    });

    await fireEvent.press(screen.getByTestId(`post.proposal.${B}.edit`));
    await fireEvent.changeText(await screen.findByTestId('post.edit.text'), '  ');
    await fireEvent.press(screen.getByTestId('post.edit.save'));
    expect(screen.getByText('Taahhüt metni boş olamaz.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('post.edit.text'), 'Sözleşmeyi ben okuyacağım');
    await fireEvent.press(screen.getByTestId('ui.segmentedControl.user_owes'));
    await fireEvent.press(screen.getByText('Yarın'));
    await fireEvent.press(screen.getByTestId('post.edit.save'));
    await waitFor(() => {
      expect(screen.queryByTestId('post.edit')).toBeNull();
    });
    const patch = api.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      expected_payload_version: 1,
      payload_patch: {
        text: 'Sözleşmeyi ben okuyacağım',
        direction: 'user_owes',
        due_at: '2026-09-25T21:00:00.000Z',
        due_precision: 'date',
      },
    });
    expect(events('commitment_proposal_edited').at(-1)?.props).toEqual({
      fields_changed_count: 3,
    });
    expect(screen.getByText('Sözleşmeyi ben okuyacağım')).toBeOnTheScreen();
    expect(screen.getByTestId(`post.proposal.${B}.toggle`)).toBeChecked();
  });

  it('clears the due date with "Tarih yok" and reports an edit conflict', async () => {
    const { api } = postSetup({
      [`POST /meetings/${EVENT}/post`]: () => extracted([proposal(2110)]),
      [`PATCH /approvals/${A}`]: () => json(409, errorBody('APPROVAL_STATE_CONFLICT')),
    });
    await openPost();
    await typeNote('Teklif.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    await fireEvent.press(await screen.findByTestId(`post.proposal.${A}.edit`));
    await fireEvent.press(await screen.findByText('Tarih yok'));
    await fireEvent.press(screen.getByTestId('post.edit.save'));
    expect(
      await screen.findByText('Bu öneri başka bir yerde değişti. Kapatıp tekrar aç.'),
    ).toBeOnTheScreen();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      expected_payload_version: 1,
      payload_patch: { due_at: null, due_precision: 'none' },
    });
    await fireEvent.press(screen.getByText('Vazgeç'));
    await waitFor(() => {
      expect(screen.queryByTestId('post.edit')).toBeNull();
    });
  });

  it('keeps a failed row selectable, saves on retry and opens the commitments', async () => {
    const first = commitmentApproval(2110);
    const { api } = postSetup({
      [`POST /meetings/${EVENT}/post`]: () => extracted([proposal(2110)]),
      [`POST /approvals/${A}/approve`]: sequence(
        json(422, errorBody('VALIDATION_FAILED')),
        json(200, ok(approved(first))),
      ),
    });
    const { router } = await openPost();
    await typeNote('Teklif.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    await fireEvent.press(await screen.findByTestId('post.save'));
    expect(await screen.findByText('Kaydedilemedi · Tekrar dene')).toBeOnTheScreen();
    expect(screen.queryByTestId('post.saved')).toBeNull();
    await fireEvent.press(screen.getByTestId('post.save'));
    expect(await screen.findByText('1 taahhüt kaydedildi.')).toBeOnTheScreen();
    expect(
      api.calls.filter((c) => c.url.endsWith(`/approvals/${A}/approve`)).map((c) => c.body),
    ).toEqual([
      { idempotency_key: first.idempotency_key, payload_version: 1, approved_via: 'in_place' },
      { idempotency_key: first.idempotency_key, payload_version: 1, approved_via: 'in_place' },
    ]);
    await fireEvent.press(screen.getByText('Taahhütleri Gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/commitments');
    });
  });

  it('disables "Kaydet" with nothing selected', async () => {
    postSetup({ [`POST /meetings/${EVENT}/post`]: () => extracted([proposal(2110)]) });
    await openPost();
    await typeNote('Teklif.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    await fireEvent.press(await screen.findByTestId(`post.proposal.${A}.toggle`));
    expect(screen.getByTestId('post.save')).toBeDisabled();
    expect(screen.getByTestId(`post.proposal.${A}.toggle`)).not.toBeChecked();
  });

  it('asks before discarding, then rejects every proposal with user_cancel and deletes the note', async () => {
    const { api, fake } = postSetup({
      [`POST /meetings/${EVENT}/post`]: () => extracted([proposal(2110), proposal(2111)]),
      [`POST /approvals/${A}/reject`]: () =>
        json(
          200,
          ok(commitmentApproval(2110, { status: 'rejected', rejected_at: '2026-09-24T10:00:00Z' })),
        ),
      [`POST /approvals/${B}/reject`]: () =>
        json(
          200,
          ok(commitmentApproval(2111, { status: 'rejected', rejected_at: '2026-09-24T10:00:00Z' })),
        ),
    });
    const { router } = await openPost();
    await typeNote('Teklif.');
    await fireEvent.press(screen.getByTestId('post.extract'));
    await screen.findByTestId('post.proposals');
    await fireEvent.press(nth(screen.getAllByTestId('ui.detailHeader.leading'), -1));
    expect(await screen.findByTestId('post.discardConfirm')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Vazgeç'));
    expect(screen.queryByTestId('post.discardConfirm')).toBeNull();
    await fireEvent.press(nth(screen.getAllByTestId('ui.detailHeader.leading'), -1));
    await fireEvent.press(await screen.findByTestId('post.discard'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(
      api.calls
        .filter((c) => c.url.endsWith('/reject'))
        .map((c) => [c.url.split('/').at(-2), c.body]),
    ).toEqual([
      [A, { reason: 'user_cancel', learn: false }],
      [B, { reason: 'user_cancel', learn: false }],
    ]);
    expect(fake.data.calls.some((c) => c.kind === 'delete' && c.target === 'meeting_notes')).toBe(
      true,
    );
    expect(events('post_meeting_discarded')).toHaveLength(1);
  });
});
