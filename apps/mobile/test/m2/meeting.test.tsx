/**
 * T-8.14 · Meeting Prep (M-MEET-01), 2-minute summary (M-MEET-03) and post-meeting capture
 * (M-MEET-04): generating → ready, Pro gate, allow-listed join link only, paragraph TTS, and
 * "Kaydet" approving selected proposals in place while unselected ones are rejected.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Speech from 'expo-speech';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { json, renderApp, resetAppState, type RecordedCall } from '../helpers/app';
import { ok, uuid } from '../helpers/fixtures';
import { chapterSkip, summaryParagraphs } from '../../src/features/meeting/MeetingSummaryScreen';
import { defaultSelected } from '../../src/features/meeting/PostMeetingScreen';
import { approved, commitmentApproval, events, setup, SOURCE } from './harness';

const EVENT_ID = uuid(500);
const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    title: 'Müşteri toplantısı',
    start_at: iso(30),
    end_at: iso(90),
    all_day: false,
    location: 'Ofis',
    conference_url: 'https://meet.google.com/abc-defg-hij',
    attendees: [
      { name: 'Ahmet', email: 'ahmet@example.com', response: 'accepted', is_self: true },
      {
        name: 'Mehmet Yılmaz',
        email: 'mehmet@example.com',
        response: 'accepted',
        contact_id: uuid(700),
      },
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

function prep(
  status: 'generating' | 'ready',
  joinUrl: string | null = 'https://meet.google.com/abc-defg-hij',
) {
  return {
    prep: {
      id: uuid(501),
      calendar_event_id: EVENT_ID,
      status,
      event: {
        title: 'Müşteri toplantısı',
        start: iso(30),
        end: iso(90),
        location: 'Ofis',
        join_url: joinUrl,
      },
      people: [{ contact_id: uuid(700), name: 'Mehmet Yılmaz', role_text: null }],
      purpose: null,
      previous_communication: [],
      recent_emails:
        status === 'ready'
          ? [
              {
                email_message_id: uuid(90),
                subject: 'Teklif v2',
                summary: 'Fiyat soruldu.',
                date: iso(-600),
              },
            ]
          : [],
      open_loops: [],
      user_commitments: [],
      other_commitments: [],
      relevant_files: [],
      talking_points:
        status === 'ready'
          ? [
              { text: 'Fiyat revizyonu', sources: [SOURCE] },
              { text: 'Teslim tarihi', sources: [SOURCE] },
            ]
          : [],
      two_minute_summary:
        status === 'ready'
          ? { text: 'Geçen hafta teklif gönderildi.\n\nFiyat soruldu.', sources: [SOURCE] }
          : null,
      generated_at: status === 'ready' ? iso(-5) : null,
      source_hash: 'hash-1',
    },
    job: null,
  };
}

beforeEach(async () => {
  await resetAppState();
  jest.mocked(Speech.speak).mockClear();
});

describe('M-MEET-01 · Toplantıya Hazırlan', () => {
  it('polls a generating prep until it is ready, then shows sourced points and the join link', async () => {
    let calls = 0;
    const { api } = setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        [`POST /meetings/${EVENT_ID}/prep`]: () => {
          calls += 1;
          return json(200, ok(prep(calls === 1 ? 'generating' : 'ready')));
        },
      },
    });
    await renderApp(`/meeting/${EVENT_ID}/prep`);
    expect(await screen.findByTestId('prep.generating')).toBeOnTheScreen();
    await waitFor(
      () => {
        expect(screen.getByText('Fiyat revizyonu')).toBeOnTheScreen();
      },
      { timeout: 6000 },
    );
    expect(screen.getByText('Teslim tarihi')).toBeOnTheScreen();
    expect(screen.getByTestId('prep.join')).toBeOnTheScreen();
    // Opened by URL (no in-app origin): a deep link.
    expect(events('meeting_prep_opened')[0]?.props).toEqual({
      origin: 'deeplink',
      minutes_to_start_bucket: '15-30',
    });
    const bodies = api.calls
      .filter((c: RecordedCall) => c.url.endsWith('/prep'))
      .map((c) => c.body);
    expect(bodies[0]).toEqual({ refresh: false });
  }, 15_000);

  it('hides the join button for a link outside the conferencing allow-list', async () => {
    setup({
      pro: true,
      data: {
        tables: {
          calendar_events: [eventRow({ conference_url: 'https://evil.example/meet.google.com' })],
        },
      },
      api: { [`POST /meetings/${EVENT_ID}/prep`]: () => json(200, ok(prep('ready', null))) },
    });
    await renderApp(`/meeting/${EVENT_ID}/prep`);
    expect(await screen.findByText('Fiyat revizyonu')).toBeOnTheScreen();
    expect(screen.queryByTestId('prep.join')).toBeNull();
  });

  it('shows the Pro gate to a Free user without generating a prep', async () => {
    const { api } = setup({ data: { tables: { calendar_events: [eventRow()] } } });
    await renderApp(`/meeting/${EVENT_ID}/prep`);
    expect(await screen.findByText('Toplantı hazırlığı Pro ile gelir.')).toBeOnTheScreen();
    expect(api.calls.some((c) => c.url.includes('/meetings/'))).toBe(false);
  });
});

describe('M-MEET-03 · 2 Dakikalık Özet', () => {
  it('splits the summary into paragraphs', () => {
    expect(summaryParagraphs('Bir.\n\nİki.\nÜç.')).toEqual(['Bir.', 'İki.', 'Üç.']);
  });

  it('reads the first paragraph aloud with the device voice', async () => {
    setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: { [`POST /meetings/${EVENT_ID}/prep`]: () => json(200, ok(prep('ready'))) },
    });
    await renderApp(`/meeting/${EVENT_ID}/summary`);
    expect(await screen.findByText('Nerede kalmıştınız?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('summary.listen'));
    await waitFor(() => {
      expect(Speech.speak).toHaveBeenCalledWith(
        'Geçen hafta teklif gönderildi.',
        expect.objectContaining({ language: 'tr-TR', rate: 1 }),
      );
    });
    expect(events('meeting_summary_audio_played')[0]?.props).toEqual({
      engine: 'native',
      speed: '1',
    });
  });
});

describe('M-MEET-03 · premium audio (API-MEET-04)', () => {
  it('computes chapter skips like the Listen screen', () => {
    const chapters = [
      { index: 0, title: 'Giriş', start_s: 0 },
      { index: 1, title: 'Teklif', start_s: 40 },
    ];
    expect(chapterSkip(chapters, 10, 1)).toBe(40);
    expect(chapterSkip(chapters, 45, -1)).toBe(40);
    expect(chapterSkip(chapters, 41, -1)).toBe(0);
    expect(chapterSkip(chapters, 50, 1)).toBe(50);
  });

  it('plays the premium file with expo-audio when the server returns one', async () => {
    const audio = jest.requireMock<{
      readonly __player: {
        readonly play: jest.Mock;
        readonly seekTo: jest.Mock;
        readonly setPlaybackRate: jest.Mock;
      };
    }>('expo-audio');
    audio.__player.play.mockClear();
    const { api } = setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        [`POST /meetings/${EVENT_ID}/prep`]: () => json(200, ok(prep('ready'))),
        [`POST /meetings/${EVENT_ID}/prep/audio`]: () =>
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
              ],
            }),
          ),
      },
    });
    await renderApp(`/meeting/${EVENT_ID}/summary`);
    expect(await screen.findByTestId('summary.premium')).toBeOnTheScreen();
    expect(screen.queryByTestId('summary.listen')).toBeNull();
    expect(screen.getByText('Doğal sesle okunur.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('summary.premium.playPause'));
    expect(audio.__player.play).toHaveBeenCalled();
    expect(events('meeting_summary_audio_played')[0]?.props).toEqual({
      engine: 'premium',
      speed: '1',
    });
    await fireEvent.press(screen.getByTestId('summary.premium.speed'));
    expect(audio.__player.setPlaybackRate).toHaveBeenLastCalledWith(1.25, 'high');
    const body = api.calls.find((c: RecordedCall) => c.url.endsWith('/prep/audio'))?.body;
    expect(body).toEqual({ prep_version_hash: 'hash-1' });
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('keeps the device voice while the premium file is still generating', async () => {
    setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow()] } },
      api: {
        [`POST /meetings/${EVENT_ID}/prep`]: () => json(200, ok(prep('ready'))),
        [`POST /meetings/${EVENT_ID}/prep/audio`]: () =>
          json(
            200,
            ok({
              mode: 'native',
              language: 'tr-TR',
              paragraphs: ['Geçen hafta teklif gönderildi.'],
              notice_key: null,
              premium_status: 'generating',
            }),
          ),
      },
    });
    await renderApp(`/meeting/${EVENT_ID}/summary`);
    expect(
      await screen.findByText('Doğal ses hazırlanıyor; şimdilik cihaz sesiyle okunur.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('summary.listen')).toBeOnTheScreen();
    expect(screen.queryByTestId('summary.premium')).toBeNull();
  });
});

describe('M-MEET-04 · Toplantı Sonrası', () => {
  it('selects confident dated proposals by default', () => {
    expect(defaultSelected({ confidence: 0.9, dueAt: iso(60), dueText: 'yarın' })).toBe(true);
    expect(defaultSelected({ confidence: 0.5, dueAt: iso(60), dueText: null })).toBe(false);
    expect(defaultSelected({ confidence: 0.9, dueAt: null, dueText: 'haftaya' })).toBe(false);
  });

  it('approves the selected proposal in place and rejects the unselected one on "Kaydet"', async () => {
    const first = commitmentApproval(801);
    const second = commitmentApproval(802);
    const { api } = setup({
      pro: true,
      data: { tables: { calendar_events: [eventRow({ start_at: iso(-90), end_at: iso(-30) })] } },
      api: {
        [`POST /meetings/${EVENT_ID}/post`]: () =>
          json(
            201,
            ok({
              note_id: uuid(803),
              none_found: false,
              proposals: [
                {
                  approval: first,
                  text: 'Mehmet’e teklif gönder',
                  counterparty_label: 'Mehmet Yılmaz',
                  due_at: iso(24 * 60),
                  due_text: 'yarın',
                  direction: 'user_owes',
                  confidence: 0.92,
                  quote: 'yarın teklif göndereceğim',
                },
                {
                  approval: second,
                  text: 'Hukuk ekibi sözleşmeyi okuyacak',
                  counterparty_label: 'Hukuk ekibi',
                  due_at: null,
                  due_text: null,
                  direction: 'they_owe',
                  confidence: 0.55,
                  quote: 'hukuk bakacak',
                },
              ],
            }),
          ),
        [`POST /approvals/${uuid(801)}/approve`]: () => json(200, ok(approved(first))),
        [`POST /approvals/${uuid(802)}/reject`]: () =>
          json(200, ok({ ...second, status: 'rejected', rejected_at: iso(0) })),
      },
    });
    await renderApp(`/meeting/${EVENT_ID}/post`);
    await fireEvent.press(await screen.findByTestId('post.modeToggle'));
    await fireEvent.changeText(
      screen.getByTestId('post.input'),
      'Mehmet’e yarın teklif göndereceğim. Hukuk bakacak.',
    );
    await fireEvent.press(screen.getByTestId('post.extract'));
    await waitFor(() => {
      expect(screen.queryByTestId('post.extracting')).toBeNull();
    });
    expect(screen.queryByTestId('post.extractFailed')).toBeNull();
    expect(await screen.findByTestId('post.proposals')).toBeOnTheScreen();
    expect(screen.getByText('Hukuk ekibi sözleşmeyi okuyacak')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('post.save'));
    expect(await screen.findByText('1 taahhüt kaydedildi.')).toBeOnTheScreen();

    const approve = api.calls.find((c) => c.url.endsWith(`/approvals/${uuid(801)}/approve`));
    expect(approve?.body).toEqual({
      idempotency_key: first.idempotency_key,
      payload_version: 1,
      approved_via: 'in_place',
    });
    expect(api.calls.some((c) => c.url.endsWith(`/approvals/${uuid(802)}/approve`))).toBe(false);
    const reject = api.calls.find((c) => c.url.endsWith(`/approvals/${uuid(802)}/reject`));
    expect(reject?.body).toEqual({ reason: 'user_reject', learn: false });
    expect(events('post_meeting_commitments_saved')[0]?.props).toEqual({
      count: 1,
      edited_count: 0,
    });
  });
});
