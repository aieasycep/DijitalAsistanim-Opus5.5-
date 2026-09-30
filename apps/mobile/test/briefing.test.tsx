/**
 * T-8.09 briefings and weekly: the morning detail (section order, empty sections hidden, RPC-07
 * `mark_briefing_opened`), the Free gates (midday, audio), the failed state's retry, "Yarına
 * Hazırım" (API-BRF-02 with an idempotency key), the premium player (exact ±15 s, rate cycle,
 * chapter seek), the native-TTS timeline, the weekly review (zero rows hidden, deadline phrasing)
 * and the share card (captured image, native share, no names).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { groupByDate } from '../src/features/briefing/BriefingHistoryScreen';
import { clampSeek, nextRate } from '../src/features/briefing/ListenScreen';
import { buildQueue, chapterStart, skip, totalDuration } from '../src/features/briefing/tts-queue';
import { json, resetAppState, type Responder } from './helpers/app';
import { ok, uuid } from './helpers/fixtures';
import { ID, events, openApp, proBootstrap } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

interface AudioMock {
  readonly __player: { readonly seekTo: jest.Mock; readonly setPlaybackRate: jest.Mock };
  readonly __status: { currentTime: number; duration: number };
}

const DAY = '2026-09-24';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.briefing,
    kind: 'morning',
    local_date: DAY,
    status: 'ready',
    origin: 'scheduled',
    headline: null,
    narrative: null,
    provenance: null,
    generated_at: '2026-09-24T05:00:00Z',
    audio_status: null,
    audio_duration_s: null,
    opened_at: null,
    evening_ready_at: null,
    counts: null,
    weekly_stats: null,
    skipped_reason: null,
    version: 1,
    ...overrides,
  };
}

function item(
  id: string,
  section: string,
  position: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    briefing_id: ID.briefing,
    section,
    position,
    badge: null,
    title: `Konu ${String(position)}`,
    meta: null,
    entity_type: null,
    entity_id: null,
    insight_id: null,
    confidence: 1,
    done_at: null,
    source_type: null,
    source_id: null,
    ...overrides,
  };
}

async function openBriefing(
  path: string,
  tables: { briefing?: Record<string, unknown>; items?: readonly Record<string, unknown>[] },
  options: { pro?: boolean; routes?: Readonly<Record<string, Responder>> } = {},
) {
  return openApp({
    ...(options.pro === true ? { data: proBootstrap() } : {}),
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    path,
    setup: (db) => {
      db.setTable('briefings', [row(tables.briefing)]);
      db.setTable('briefing_items', tables.items ?? []);
    },
  });
}

beforeEach(async () => {
  await resetAppState();
});

describe('briefing detail (M-BR-01)', () => {
  it('shows the morning sections in order, hides empty ones and marks the briefing opened', async () => {
    const { db } = await openBriefing(`/briefing/${ID.briefing}?via=push`, {
      items: [item(ID.item2, 'deadlines', 2), item(ID.item, 'priorities', 1)],
    });
    expect(await screen.findByTestId('briefing.section.priorities')).toBeOnTheScreen();
    expect(
      screen
        .getAllByTestId(/^briefing\.section\./)
        .map((e) => (e.props as { testID: string }).testID),
    ).toEqual(['briefing.section.priorities', 'briefing.section.deadlines']);
    expect(screen.queryByText('Programın')).toBeNull();
    await waitFor(() => {
      expect(db.rpcCalls.find((c) => c.name === 'mark_briefing_opened')?.args).toEqual({
        p_briefing_id: ID.briefing,
      });
    });
    expect(events('briefing_opened')[0]?.props).toEqual({ kind: 'morning', via: 'push' });
  });

  it('shows the calm state without items and the Pro gate for Free listening', async () => {
    await openBriefing(`/briefing/${ID.briefing}`, { items: [] });
    expect(await screen.findByTestId('briefing.calm')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('briefing.listen'));
    expect(await screen.findByTestId('gate.sheet.voice_briefing')).toBeOnTheScreen();
  });

  it('gates the midday briefing for Free', async () => {
    await openBriefing(`/briefing/${ID.briefing}`, { briefing: { kind: 'midday' } });
    expect(await screen.findByTestId('briefing.gate')).toBeOnTheScreen();
  });

  it('retries a failed briefing', async () => {
    const { api } = await openBriefing(
      `/briefing/${ID.briefing}`,
      { briefing: { status: 'failed' } },
      {
        routes: {
          [`POST /briefings/${ID.briefing}/retry`]: () =>
            json(
              202,
              ok({
                briefing_id: ID.briefing,
                status: 'generating',
                job: { job_id: ID.job, status: 'queued', poll_after_ms: 2000 },
              }),
            ),
        },
      },
    );
    const failed = await screen.findByTestId('briefing.failed');
    await fireEvent.press(within(failed).getByText('Tekrar Dene'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/briefings/${ID.briefing}/retry`))).toBe(true);
    });
  });

  it('shows "Bu brifing artık yok." for a removed briefing', async () => {
    await openBriefing(`/briefing/${uuid(59)}`, {});
    expect(await screen.findByText('Bu brifing artık yok.')).toBeOnTheScreen();
  });

  it('confirms "Yarına Hazırım" with the carry-over items and an idempotency key', async () => {
    const { api } = await openBriefing(
      `/briefing/${ID.briefing}`,
      {
        briefing: { kind: 'evening' },
        items: [
          item(ID.item, 'carry_over', 1, { insight_id: ID.insight }),
          item(ID.item2, 'completed', 2, { done_at: '2026-09-24T12:00:00Z' }),
        ],
      },
      {
        pro: true,
        routes: {
          [`POST /briefings/${ID.briefing}/evening-ready`]: () =>
            json(
              200,
              ok({
                carried: 1,
                next_morning_at: '2026-09-25T05:00:00Z',
                closed_at: '2026-09-24T17:00:00Z',
              }),
            ),
        },
      },
    );
    await fireEvent.press(await screen.findByTestId('briefing.eveningReady'));
    await fireEvent.press(await screen.findByTestId('eveningReady.confirm'));
    expect(await screen.findByTestId('eveningReady.success')).toBeOnTheScreen();
    const call = api.calls.find((c) => c.url.endsWith('/evening-ready'));
    expect(call?.body).toEqual({ confirm: true, carry_over_item_ids: [ID.item] });
    expect(call?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(events('evening_ready_confirmed')[0]?.props).toMatchObject({
      carried_count: 1,
      excluded_count: 0,
    });
  });
});

describe('audio player (M-BR-02)', () => {
  it('skips exactly 15 s, cycles the rate and seeks to a chapter', async () => {
    const audio = jest.requireMock<AudioMock>('expo-audio');
    audio.__status.currentTime = 100;
    audio.__status.duration = 300;
    await openBriefing(
      `/briefing/${ID.briefing}/listen`,
      { briefing: { audio_status: 'ready', audio_duration_s: 300 } },
      {
        pro: true,
        routes: {
          [`POST /briefings/${ID.briefing}/audio`]: () =>
            json(
              200,
              ok({
                mode: 'premium',
                url: 'https://cdn.example.com/briefing.mp3',
                url_expires_at: '2026-09-24T09:00:00Z',
                duration_s: 300,
                chapters: [
                  { index: 0, title: 'Öncelikler', start_s: 0, duration_s: 120 },
                  { index: 1, title: 'Toplantılar', start_s: 120, duration_s: 180 },
                ],
              }),
            ),
        },
      },
    );
    expect(await screen.findByTestId('player.premium')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('15 sn geri'));
    expect(audio.__player.seekTo).toHaveBeenLastCalledWith(85);
    await fireEvent.press(screen.getByLabelText('15 sn ileri'));
    expect(audio.__player.seekTo).toHaveBeenLastCalledWith(115);
    await fireEvent.press(screen.getByLabelText('Hız, 1 kat'));
    expect(audio.__player.setPlaybackRate).toHaveBeenLastCalledWith(1.25, 'high');
    await fireEvent.press(screen.getByText('Toplantılar'));
    expect(audio.__player.seekTo).toHaveBeenLastCalledWith(120);
    audio.__status.currentTime = 0;
    audio.__status.duration = 0;
  });

  it('clamps skips and cycles 1× → 1.25× → 1.5× → 1×', () => {
    expect(clampSeek(290, 15, 300)).toBe(300);
    expect(clampSeek(5, -15, 300)).toBe(0);
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(1.25)).toBe(1.5);
    expect(nextRate(1.5)).toBe(1);
  });

  it('estimates the native-TTS timeline by sentence', () => {
    const queue = buildQueue([
      { index: 0, title: 'Öncelikler', text: 'Bugün üç konu var. Teklif bekliyor.' },
      { index: 1, title: 'Program', text: 'Saat onda toplantın var.' },
    ]);
    expect(queue.map((s) => s.text)).toEqual([
      'Bugün üç konu var.',
      'Teklif bekliyor.',
      'Saat onda toplantın var.',
    ]);
    expect(queue[0]?.durationS).toBeCloseTo(18 / 14.5);
    expect(chapterStart(queue, 1)).toBe(2);
    expect(skip(queue, 0, 15)).toBe(2);
    expect(skip(queue, 2, -15)).toBe(0);
    expect(totalDuration(queue)).toBeCloseTo((18 + 16 + 24) / 14.5);
  });
});

describe('weekly review and share (M-BR-04, M-BR-05)', () => {
  it('hides zero rows and phrases the deadlines by what was on time', async () => {
    await openBriefing(`/weekly/${ID.briefing}`, {
      briefing: {
        kind: 'weekly',
        local_date: '2026-09-20',
        weekly_stats: {
          mails_analyzed: 120,
          important_count: 0,
          meetings: 0,
          followups: 0,
          deadlines: 3,
          deadlines_surfaced_on_time: 2,
          time_saved_min: 0,
        },
      },
    });
    const stats = await screen.findByTestId('weekly.stats');
    expect(within(stats).getByText('mail analiz edildi')).toBeOnTheScreen();
    expect(
      within(stats).getByText('son tarih, 2 tanesi zamanında öne çıkarıldı'),
    ).toBeOnTheScreen();
    expect(within(stats).queryByText('toplantı')).toBeNull();
    expect(screen.queryByTestId('weekly.timeSaved')).toBeNull();
  });

  it('captures the name-free card and hands it to the native share sheet', async () => {
    await openBriefing(
      `/weekly/${ID.weekly}/share`,
      {},
      {
        routes: {
          [`GET /weekly/${ID.weekly}/share-card`]: () =>
            json(
              200,
              ok({
                week_label: '14–20 Eylül',
                metrics: {
                  analyzed_emails: 120,
                  important_subjects: 9,
                  meetings: 4,
                  followups_closed: 3,
                  deadlines: 2,
                  estimated_time_saved_minutes: 95,
                },
                formula_version: 'v1',
                labels: { time_saved_prefix: 'Tahmini' },
                share_text: 'Dijital haftam',
              }),
            ),
        },
      },
    );
    expect(await screen.findByTestId('share.preview')).toBeOnTheScreen();
    expect(screen.getByTestId('share.card', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(/Ayşe|ahmet@/, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('share.privacy')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('share.submit'));
    await waitFor(() => {
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        'file:///cache/share.png',
        expect.objectContaining({ mimeType: 'image/png' }),
      );
    });
    expect(captureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 1080, height: 1350 }),
    );
    expect(events('weekly_share_completed')[0]?.props).toEqual({
      format: '4:5',
      with_invite: false,
    });
  });
});

describe('briefing history (M-BR-03)', () => {
  it('groups consecutive rows by local date', () => {
    const rows = [
      { ...row({ id: uuid(51), kind: 'evening' }) },
      { ...row({ id: uuid(52) }) },
      { ...row({ id: uuid(53), local_date: '2026-09-23' }) },
    ] as unknown as Parameters<typeof groupByDate>[0];
    expect(groupByDate(rows).map((g) => [g.date, g.rows.length])).toEqual([
      [DAY, 2],
      ['2026-09-23', 1],
    ]);
  });
});
