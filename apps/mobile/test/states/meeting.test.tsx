/**
 * T-8.14 · M-MEET-01 Toplantıya Hazırlan and M-MEET-03 2 Dakikalık Özet (SCREEN_AND_FLOW_MAP
 * M-MEET-01/03, API_CONTRACTS API-MEET-01 `POST /meetings/:eventId/prep`, API-MEET-04 audio): the
 * person row, every sourced section routing to its source, talking-point sources, provenance and
 * "Yenile" (`refresh: true`, rate-limited and failed), the empty prep, failed / limit / gate / error
 * states, an ended or cancelled meeting, a removed event, the offline hint; the summary's
 * paragraph reader (next / previous / speed / pause / restart), a missing Turkish voice, source
 * chips, the failed summary and the premium player's chapter skips.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as Speech from 'expo-speech';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { json, renderApp, resetAppState, type RecordedCall, type Responder } from '../helpers/app';
import { errorBody, ok, TS, uuid } from '../helpers/fixtures';
import { events, setup } from '../m2/harness';
import { back, nth } from './support';

const EVENT = uuid(2200);
const PERSON = uuid(2201);
const MAIL = uuid(2202);
const OTHER_EVENT = uuid(2203);
const COMMIT = uuid(2204);
const CAPTURE = uuid(2205);
const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    title: 'Müşteri toplantısı',
    start_at: iso(20),
    end_at: iso(80),
    all_day: false,
    location: 'Ofis',
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

const ref = (source_type: string, source_id: string | null, label?: string) => ({
  source_type,
  source_id,
  source_provider: source_type === 'email_message' ? 'google' : 'in_app',
  source_timestamp: TS,
  ...(label === undefined ? {} : { label }),
});

function prepView(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(2210),
    calendar_event_id: EVENT,
    status: 'ready',
    event: {
      title: 'Müşteri toplantısı',
      start: iso(20),
      end: iso(80),
      location: 'Ofis',
      join_url: 'https://teams.microsoft.com/l/meetup-join/abc',
    },
    people: [
      { contact_id: PERSON, name: 'Mehmet Yılmaz', role_text: 'Satın alma müdürü' },
      { contact_id: uuid(2206), name: 'Ayşe Kaya', role_text: null },
    ],
    purpose: {
      text: 'Teklif revizyonunu konuşmak',
      provenance: {
        ...ref('email_message', MAIL),
        confidence: 0.9,
        evidence: [],
      },
    },
    previous_communication: [
      { text: 'Geçen hafta fiyat konuşuldu', source: ref('calendar_event', OTHER_EVENT) },
    ],
    recent_emails: [
      { email_message_id: MAIL, subject: 'Teklif v2', summary: 'Fiyat soruldu.', date: TS },
    ],
    open_loops: [{ text: 'Teslim tarihi netleşmedi', source: ref('email_message', MAIL) }],
    user_commitments: [{ commitment_id: COMMIT, text: 'Teklifi gönder', due_at: iso(24 * 60) }],
    other_commitments: [{ commitment_id: uuid(2207), text: 'Sözleşmeyi okuyacak', due_at: null }],
    relevant_files: [{ name: 'teklif.pdf', attachment_ref: 'att-1', email_message_id: MAIL }],
    talking_points: [
      {
        text: 'Fiyat revizyonu',
        sources: [ref('email_message', MAIL, 'Teklif v2'), ref('meeting_note', null, 'Not')],
      },
    ],
    two_minute_summary: {
      text: 'Geçen hafta teklif gönderildi.\n\nFiyat soruldu.',
      sources: [
        ref('email_message', MAIL, 'Teklif v2'),
        ref('email_message', uuid(2208), 'Fiyat'),
        ref('meeting_note', null),
        ref('capture', CAPTURE),
      ],
    },
    generated_at: iso(-5),
    source_hash: 'hash-1',
    ...overrides,
  };
}

const prepOk = (overrides: Record<string, unknown> = {}) =>
  json(200, ok({ prep: prepView(overrides), job: null }));

function meetingSetup(
  api: Readonly<Record<string, Responder>>,
  options: {
    pro?: boolean;
    event?: Record<string, unknown> | null;
    notes?: Record<string, unknown>[];
  } = {},
) {
  return setup({
    pro: options.pro ?? true,
    data: {
      tables: {
        calendar_events: options.event === null ? [] : [eventRow(options.event)],
        meeting_notes: options.notes ?? [],
      },
    },
    api,
  });
}

const prepCalls = (calls: readonly RecordedCall[]) =>
  calls.filter((c) => c.url.endsWith(`/meetings/${EVENT}/prep`));

async function openPrep() {
  const rendered = await renderApp(`/meeting/${EVENT}/prep`);
  await screen.findByTestId('prep.screen');
  return rendered;
}

beforeEach(async () => {
  await resetAppState();
  jest.mocked(Speech.speak).mockClear();
});

describe('M-MEET-01 · Toplantıya Hazırlan', () => {
  it('shows the person, every sourced section and the provenance', async () => {
    meetingSetup(
      { [`POST /meetings/${EVENT}/prep`]: () => prepOk() },
      {
        notes: [
          {
            id: uuid(2209),
            calendar_event_id: EVENT,
            body: 'Fiyatı sor',
            kind: 'text',
            created_at: TS,
          },
        ],
      },
    );
    await openPrep();
    expect(await screen.findByText('Mehmet Yılmaz ve 1 kişi')).toBeOnTheScreen();
    expect(screen.getByText('Satın alma müdürü')).toBeOnTheScreen();
    expect(screen.getByText("Teams'e Katıl")).toBeOnTheScreen();
    expect(screen.getByText('Teklif revizyonunu konuşmak')).toBeOnTheScreen();
    expect(screen.getByText('Geçen hafta fiyat konuşuldu')).toBeOnTheScreen();
    expect(screen.getByText('Teslim tarihi netleşmedi')).toBeOnTheScreen();
    expect(screen.getByTestId('prep.commitments.user')).toHaveTextContent(/Teklifi gönder/);
    expect(screen.getByTestId('prep.commitments.other')).toHaveTextContent(/Sözleşmeyi okuyacak/);
    expect(screen.getByText('teklif.pdf')).toBeOnTheScreen();
    expect(await screen.findByText('Fiyatı sor')).toBeOnTheScreen();
    expect(screen.getByTestId('prep.provenance')).toHaveTextContent(
      /^1 mail, 1 not ve takvim davetinden hazırlandı · /,
    );
    expect(screen.getByTestId('prep.countdown')).toBeOnTheScreen();
  });

  it.each([
    ['person', () => screen.getByTestId('prep.person'), `/person/${PERSON}`, null],
    ['purpose', () => screen.getByTestId('prep.purpose'), `/mail/${MAIL}`, 'purpose'],
    [
      'last interaction',
      () => screen.getByText('Geçen hafta fiyat konuşuldu'),
      `/event/${OTHER_EVENT}`,
      'last_interaction',
    ],
    [
      'open loop',
      () => screen.getByText('Teslim tarihi netleşmedi'),
      `/mail/${MAIL}`,
      'open_loops',
    ],
    ['email', () => screen.getByTestId(`prep.email.${MAIL}`), `/mail/${MAIL}`, 'emails'],
    [
      'commitment',
      () => screen.getByText('Teklifi gönder'),
      `/commitments/${COMMIT}`,
      'commitments',
    ],
    ['file', () => screen.getByText('teklif.pdf'), `/mail/${MAIL}`, 'files'],
  ])('opens the %s source', async (_name, target, path, section) => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    const { router } = await openPrep();
    await screen.findByText('Fiyat revizyonu');
    await fireEvent.press(target());
    await waitFor(() => {
      expect(router.getPathname()).toBe(path);
    });
    if (section !== null) {
      expect(events('meeting_prep_source_opened').at(-1)?.props).toEqual({ section });
    }
  });

  it('lists a talking point’s sources on long press and opens the openable one', async () => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    const { router } = await openPrep();
    await fireEvent(await screen.findByTestId('ui.talkingPoints.0'), 'accessibilityAction', {
      nativeEvent: { actionName: 'longpress' },
    });
    const menu = await screen.findByTestId('m2.menu');
    expect(within(menu).getByTestId('m2.menu.1')).toBeDisabled();
    await fireEvent.press(within(menu).getByTestId('m2.menu.0'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MAIL}`);
    });
    expect(events('meeting_prep_source_opened').at(-1)?.props).toEqual({
      section: 'talking_points',
    });
  });

  it('joins through the OS, opens the summary, the event details and the note sheet', async () => {
    const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    const { router } = await openPrep();
    await fireEvent.press(await screen.findByTestId('prep.join'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith('https://teams.microsoft.com/l/meetup-join/abc');
    });
    expect(canOpen).toHaveBeenCalled();
    expect(events('external_handoff').at(-1)?.props).toEqual({ target: 'meeting_link' });
    await fireEvent.press(screen.getByTestId('prep.note'));
    expect(await screen.findByTestId('meeting.note')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('meeting.note.cancel'));
    await fireEvent.press(screen.getByTestId('prep.more'));
    await fireEvent.press(await screen.findByTestId('m2.menu.details'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/event/${EVENT}`);
    });
    await back();
    await fireEvent.press(await screen.findByTestId('prep.summary'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/summary`);
    });
  });

  it('refreshes with refresh: true and explains a rate limit and a failure', async () => {
    let n = 0;
    const { api } = meetingSetup({
      [`POST /meetings/${EVENT}/prep`]: () => {
        n += 1;
        if (n === 2) return json(429, errorBody('RATE_LIMITED'));
        if (n === 3) return json(422, errorBody('VALIDATION_FAILED'));
        return prepOk();
      },
    });
    await openPrep();
    await fireEvent.press(await screen.findByTestId('prep.refresh'));
    expect(
      await screen.findByText('Hazırlık az önce yenilendi. Birkaç dakika sonra tekrar dene.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('prep.refresh'));
    expect(
      await screen.findByText('Hazırlık yenilenemedi.', undefined, { timeout: 6000 }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('prep.refresh'));
    await waitFor(() => {
      expect(events('meeting_prep_refreshed')).toHaveLength(1);
    });
    expect(prepCalls(api.calls).map((c) => c.body)).toEqual([
      { refresh: false },
      { refresh: true },
      { refresh: true },
      { refresh: true },
    ]);
  }, 20_000);

  it('offers notes when nothing was found and a retry for a failed prep', async () => {
    let n = 0;
    const { api } = meetingSetup({
      [`POST /meetings/${EVENT}/prep`]: () => {
        n += 1;
        return n === 1
          ? prepOk({ status: 'failed' })
          : prepOk({
              people: [],
              purpose: null,
              previous_communication: [],
              recent_emails: [],
              open_loops: [],
              user_commitments: [],
              other_commitments: [],
              relevant_files: [],
              talking_points: [],
              generated_at: null,
              event: {
                title: 'Müşteri toplantısı',
                start: iso(20),
                end: iso(80),
                location: null,
                join_url: null,
              },
            });
      },
    });
    await openPrep();
    expect(await screen.findByTestId('prep.failed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Tekrar Dene'));
    expect(await screen.findByTestId('prep.noPoints')).toBeOnTheScreen();
    expect(prepCalls(api.calls).at(-1)?.body).toEqual({ refresh: true });
    expect(screen.getByText('Davet açıklaması yok.')).toBeOnTheScreen();
    expect(screen.getByText('İlk görüşmeniz.')).toBeOnTheScreen();
    expect(screen.getByText('Bu kişiyle mail geçmişi bulunamadı.')).toBeOnTheScreen();
    // The short provenance (no generation time) is followed only by "Yenile".
    expect(screen.getByTestId('prep.provenance')).toHaveTextContent(
      /^0 mail, 0 not ve takvim davetinden hazırlandıYenile$/,
    );
    await fireEvent.press(screen.getByText('Notlarını ekle'));
    expect(await screen.findByTestId('meeting.note')).toBeOnTheScreen();
  });

  it.each([
    ['ENTITLEMENT_REQUIRED', 403, 'Toplantı hazırlığı Pro ile gelir.'],
    ['QUOTA_EXCEEDED', 429, 'Bugünkü AI analiz hakkın doldu. Hazırlık yarın oluşturulabilir.'],
    ['VALIDATION_FAILED', 422, null],
  ])('shows the %s prep state', async (code, status, text) => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => json(status, errorBody(code)) });
    await openPrep();
    // A non-retryable failure carries the server correlation id for support.
    if (text === null) {
      expect(await screen.findByTestId('prep.error.corr-server-1')).toBeOnTheScreen();
      expect(screen.getByText('Toplantıya Hazırlan yüklenemedi.')).toBeOnTheScreen();
    } else expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('offers the post-meeting note once the meeting ended', async () => {
    meetingSetup(
      {
        [`POST /meetings/${EVENT}/prep`]: () =>
          prepOk({
            event: {
              title: 'Müşteri toplantısı',
              start: iso(-90),
              end: iso(-30),
              location: null,
              join_url: 'https://meet.google.com/abc-defg-hij',
            },
          }),
      },
      { event: { start_at: iso(-90), end_at: iso(-30) } },
    );
    const { router } = await openPrep();
    await fireEvent.press(await screen.findByTestId('prep.post'));
    expect(screen.queryByTestId('prep.join')).toBeNull();
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/post`);
    });
    expect(events('meeting_prep_opened').at(-1)?.props).toMatchObject({
      minutes_to_start_bucket: 'ended',
    });
  });

  it('sends a cancelled meeting back to the plan', async () => {
    meetingSetup(
      { [`POST /meetings/${EVENT}/prep`]: () => prepOk() },
      { event: { status: 'cancelled' } },
    );
    const { router } = await openPrep();
    expect(await screen.findByTestId('prep.cancelled')).toBeOnTheScreen();
    expect(screen.queryByTestId('prep.join')).toBeNull();
    await fireEvent.press(screen.getByText("Plan'a Dön"));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
  });

  it('says the meeting was removed when its event is gone', async () => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() }, { event: null });
    await renderApp(`/meeting/${EVENT}/prep`);
    expect(await screen.findByTestId('prep.notFound')).toBeOnTheScreen();
    expect(screen.getByText('Bu toplantı takviminden kaldırılmış.')).toBeOnTheScreen();
  });

  it('explains offline that the prep waits for a connection', async () => {
    let answer: (response: Response) => void = () => undefined;
    meetingSetup({
      [`POST /meetings/${EVENT}/prep`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await openPrep();
    expect(await screen.findByTestId('prep.generating')).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(
      await screen.findByText('Çevrimdışısın. Hazırlık bağlantı gelince oluşturulur.'),
    ).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(true);
      answer(prepOk());
      await Promise.resolve();
    });
    expect(await screen.findByText('Fiyat revizyonu')).toBeOnTheScreen();
  });
});

describe('M-MEET-03 · 2 Dakikalık Özet', () => {
  const speakCalls = () => jest.mocked(Speech.speak).mock.calls;
  const lastOptions = () => speakCalls().at(-1)?.[1];

  async function openSummary() {
    const rendered = await renderApp(`/meeting/${EVENT}/summary`);
    await screen.findByText('Nerede kalmıştınız?');
    return rendered;
  }

  it('reads paragraph by paragraph with next, previous, speed, pause and restart', async () => {
    meetingSetup({
      [`POST /meetings/${EVENT}/prep`]: () => prepOk(),
      [`POST /meetings/${EVENT}/prep/audio`]: () =>
        json(
          200,
          ok({
            mode: 'native',
            language: 'tr-TR',
            paragraphs: [],
            notice_key: null,
            premium_status: null,
          }),
        ),
    });
    await openSummary();
    expect(screen.getByText(/^Mehmet Yılmaz · /)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('summary.listen'));
    await waitFor(() => {
      expect(speakCalls().at(-1)?.[0]).toBe('Geçen hafta teklif gönderildi.');
    });
    await act(async () => {
      lastOptions()?.onDone?.();
      await Promise.resolve();
    });
    expect(speakCalls().at(-1)?.[0]).toBe('Fiyat soruldu.');
    expect(screen.getByText('2/2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('summary.prev'));
    expect(speakCalls().at(-1)?.[0]).toBe('Geçen hafta teklif gönderildi.');
    await fireEvent.press(screen.getByTestId('summary.next'));
    await fireEvent.press(screen.getByTestId('summary.speed'));
    expect(lastOptions()).toMatchObject({ rate: 1.25 });
    await fireEvent.press(screen.getByTestId('summary.playPause'));
    expect(Speech.stop).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Baştan oku'));
    expect(speakCalls().at(-1)?.[0]).toBe('Geçen hafta teklif gönderildi.');
    // An error stops the reader; the last paragraph finishing resets it.
    await act(async () => {
      lastOptions()?.onError?.(new Error('tts'));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('summary.player')).toBeNull();
    await fireEvent.press(screen.getByTestId('summary.listen'));
    await fireEvent.press(await screen.findByTestId('summary.next'));
    expect(speakCalls().at(-1)?.[0]).toBe('Fiyat soruldu.');
    await act(async () => {
      lastOptions()?.onDone?.();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('summary.player')).toBeNull();
  });

  it('asks for a Turkish voice when the device has none', async () => {
    jest
      .mocked(Speech.getAvailableVoicesAsync)
      .mockResolvedValueOnce([
        { identifier: 'en', name: 'Samantha', quality: 'Default', language: 'en-US' },
      ] as never);
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    await openSummary();
    await fireEvent.press(screen.getByTestId('summary.listen'));
    expect(await screen.findByText(/Bu cihazda Türkçe ses bulunamadı\./)).toBeOnTheScreen();
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('groups the sources and opens them from a chip or a paragraph', async () => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    const { router } = await openSummary();
    expect(screen.getByText('2 mail')).toBeOnTheScreen();
    expect(screen.getByText('1 not')).toBeOnTheScreen();
    expect(screen.getByText('1 dosya')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('summary.paragraph.0'), 'longPress');
    const menu = await screen.findByTestId('m2.menu');
    expect(within(menu).getByText('Teklif v2')).toBeOnTheScreen();
    await fireEvent.press(within(menu).getByText('Fiyat'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${uuid(2208)}`);
    });
    await back();
    await fireEvent.press(await screen.findByTestId('summary.source.capture'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${CAPTURE}`);
    });
    expect(events('meeting_summary_source_opened').map((e) => e.props.type)).toEqual([
      'email_message',
      'capture',
    ]);
  });

  it('returns to the prep when the summary could not be made', async () => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk({ two_minute_summary: null }) });
    const { router } = await openPrep();
    await screen.findByText('Fiyat revizyonu');
    await fireEvent.press(screen.getByTestId('prep.summary'));
    expect(await screen.findByTestId('summary.failed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Hazırlığa Dön'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/prep`);
    });
  });

  it('skips premium chapters and pauses a playing file', async () => {
    const audio = jest.requireMock<{
      readonly __player: {
        readonly pause: jest.Mock;
        readonly seekTo: jest.Mock;
        readonly play: jest.Mock;
      };
      readonly __status: { currentTime: number; duration: number; playing: boolean };
    }>('expo-audio');
    audio.__status.currentTime = 50;
    audio.__status.duration = 90;
    audio.__status.playing = true;
    try {
      meetingSetup({
        [`POST /meetings/${EVENT}/prep`]: () => prepOk(),
        [`POST /meetings/${EVENT}/prep/audio`]: () =>
          json(
            200,
            ok({
              mode: 'premium',
              signed_url: 'https://files.example.com/prep/hash-1.mp3?token=t',
              expires_at: iso(5),
              duration_s: 90,
              chapters: [
                { index: 0, title: 'Giriş', start_s: 0 },
                { index: 1, title: 'Teklif', start_s: 40 },
                { index: 2, title: 'Kapanış', start_s: 70 },
              ],
            }),
          ),
      });
      await renderApp(`/meeting/${EVENT}/summary`);
      expect(await screen.findByTestId('summary.premium')).toBeOnTheScreen();
      expect(screen.getByText('0:50 / 1:30')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('summary.premium.prev'));
      expect(audio.__player.seekTo).toHaveBeenLastCalledWith(40);
      await fireEvent.press(screen.getByTestId('summary.premium.next'));
      expect(audio.__player.seekTo).toHaveBeenLastCalledWith(70);
      await fireEvent.press(screen.getByTestId('summary.premium.playPause'));
      expect(audio.__player.pause).toHaveBeenCalled();
    } finally {
      audio.__status.currentTime = 0;
      audio.__status.duration = 0;
      audio.__status.playing = false;
    }
  });

  it('closes the reader back to the prep', async () => {
    meetingSetup({ [`POST /meetings/${EVENT}/prep`]: () => prepOk() });
    const { router } = await openPrep();
    await screen.findByText('Fiyat revizyonu');
    await fireEvent.press(screen.getByTestId('prep.summary'));
    await screen.findByText('Nerede kalmıştınız?');
    await fireEvent.press(nth(screen.getAllByTestId('ui.detailHeader.leading'), -1));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/meeting/${EVENT}/prep`);
    });
  });
});
