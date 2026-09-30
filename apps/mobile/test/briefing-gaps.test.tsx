/**
 * Briefing platform gaps: the data-only `device_refresh` push and its background task (KPL-11,
 * KPL-12), the device-calendar freshness notes on a briefing (shared fingerprint vector), the P:08
 * staged opening of the morning briefing (first open only), and the audio mini player (DEV-52)
 * over a running session.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';

import * as DeviceCalendar from '../src/features/integrations/device-calendar';
import {
  BACKGROUND_NOTIFICATION_TASK,
  pushTypeOf,
  refreshForPush,
  runBackgroundNotificationTask,
  syncBackgroundNotificationTask,
} from '../src/features/integrations/device-refresh-push';
import { deviceScheduleFingerprint } from '../src/features/briefing/device-freshness';
import { startSession, stopSession } from '../src/features/briefing/player/store';
import * as BackgroundRefresh from '../src/lib/background-refresh';
import { presentForegroundNotification } from '../src/lib/notifications/handlers';
import { resetAppState } from './helpers/app';
import { appRouter, events, ID, openApp } from './helpers/journeys';
import type { PostgrestFake } from './helpers/postgrest';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

/** The shared vector (the domain and Edge suites assert the same SHA-256). */
const VECTOR = {
  events: [
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      start_at: '2026-09-30T05:00:00+00:00',
      end_at: '2026-09-30T06:00:00+00:00',
      status: 'confirmed',
    },
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      start_at: '2026-09-30T03:00:00.000Z',
      end_at: '2026-09-30T03:30:00.000Z',
      status: 'tentative',
    },
  ],
  sha256: '3b72688e0c1f380a80394375f7db58f99ff10af5b95ef837f9f94f54eca80f80',
};
const DEVICE_ACCOUNT = '00000000-0000-4000-8000-0000000000d1';

beforeEach(async () => {
  await resetAppState();
  jest.clearAllMocks();
});

describe('device_refresh push (KPL-12)', () => {
  it('finds the type wherever the platform put the payload', () => {
    expect(pushTypeOf({ data: { type: 'device_refresh', entity_id: null } })).toBe(
      'device_refresh',
    );
    expect(pushTypeOf({ data: { dataString: '{"type":"device_refresh"}' } })).toBe(
      'device_refresh',
    );
    expect(pushTypeOf({ data: { body: { type: 'device_refresh' } } })).toBe('device_refresh');
    expect(pushTypeOf({ body: '{"type":"device_refresh"}' })).toBe('device_refresh');
    expect(pushTypeOf('{"type":"briefing_ready"}')).toBe('briefing_ready');
    expect(pushTypeOf('not json')).toBeNull();
    expect(pushTypeOf(null)).toBeNull();
    expect(pushTypeOf({ data: { entity_id: 'x' } })).toBeNull();
  });

  it('uploads the device calendar and refreshes the widgets, one run at a time', async () => {
    const upload = jest
      .spyOn(DeviceCalendar, 'uploadDeviceSnapshot')
      .mockResolvedValue(DEVICE_ACCOUNT);
    const widgets = jest.spyOn(BackgroundRefresh, 'runBackgroundRefresh').mockResolvedValue(true);
    const [first, second] = await Promise.all([refreshForPush(), refreshForPush()]);
    expect([first, second]).toEqual(['uploaded', 'uploaded']);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(widgets).toHaveBeenCalledTimes(1);
    const { NewData, NoData, Failed } = Notifications.BackgroundNotificationTaskResult;
    expect(await runBackgroundNotificationTask({ data: { type: 'device_refresh' } })).toBe(NewData);
    upload.mockResolvedValueOnce(null);
    expect(await runBackgroundNotificationTask({ data: { type: 'device_refresh' } })).toBe(NoData);
    upload.mockRejectedValueOnce(new Error('offline'));
    expect(await runBackgroundNotificationTask({ data: { type: 'device_refresh' } })).toBe(Failed);
    expect(await runBackgroundNotificationTask({ data: { type: 'briefing_ready' } })).toBe(NoData);
    upload.mockRestore();
    widgets.mockRestore();
  });

  it('registers the task only while a device calendar is connected', async () => {
    const registered = jest.mocked(TaskManager.isTaskRegisteredAsync);
    registered.mockResolvedValueOnce(false);
    await syncBackgroundNotificationTask(true);
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    registered.mockResolvedValueOnce(true);
    await syncBackgroundNotificationTask(false);
    expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    registered.mockRejectedValueOnce(new Error('no task manager'));
    await expect(syncBackgroundNotificationTask(true)).resolves.toBeUndefined();
  });

  it('refreshes silently when the push arrives in the foreground', async () => {
    const upload = jest.spyOn(DeviceCalendar, 'uploadDeviceSnapshot').mockResolvedValue(null);
    const widgets = jest.spyOn(BackgroundRefresh, 'runBackgroundRefresh').mockResolvedValue(true);
    presentForegroundNotification({
      request: {
        content: { title: null, body: null, data: { type: 'device_refresh' } },
      },
    } as never);
    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    upload.mockRestore();
    widgets.mockRestore();
  });
});

function freshness(fingerprint = VECTOR.sha256, stale = true) {
  return {
    device_calendar: {
      sources: [{ provider: 'apple_device', last_sync_at: '2026-09-29T04:00:00.000Z', stale }],
      window_start: '2026-09-29T21:00:00.000Z',
      window_end: '2026-09-30T21:00:00.000Z',
      fingerprint,
      event_count: 2,
    },
  };
}

function briefingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.briefing,
    kind: 'morning',
    local_date: '2026-09-30',
    status: 'ready',
    origin: 'scheduled',
    headline: 'Bugün sakin bir gün.',
    narrative: null,
    provenance: null,
    generated_at: '2026-09-30T04:30:00Z',
    audio_status: null,
    audio_duration_s: null,
    opened_at: null,
    evening_ready_at: null,
    counts: null,
    weekly_stats: null,
    skipped_reason: null,
    version: 1,
    source_freshness: null,
    ...overrides,
  };
}

function item(section: string, position: number) {
  return {
    id: `00000000-0000-4000-8000-0000000006${String(position).padStart(2, '0')}`,
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
  };
}

function deviceTables(db: PostgrestFake, events = VECTOR.events) {
  db.setTable('connected_accounts', [
    {
      id: DEVICE_ACCOUNT,
      provider: 'apple_device',
      status: 'healthy',
      disconnected_at: null,
      last_successful_sync_at: '2026-09-29T04:00:00.000Z',
    },
  ]);
  db.setTable(
    'calendar_events',
    events.map((e) => ({ ...e, connected_account_id: DEVICE_ACCOUNT, provider_deleted_at: null })),
  );
}

describe('device-calendar freshness on a briefing (KPL-12)', () => {
  it('computes the shared fingerprint vector', async () => {
    expect(await deviceScheduleFingerprint(VECTOR.events)).toBe(VECTOR.sha256);
  });

  it('notes a device calendar that was stale when the briefing was generated', async () => {
    await openApp({
      path: `/briefing/${ID.briefing}`,
      setup: (db) => {
        db.setTable('briefings', [briefingRow({ source_freshness: freshness() })]);
        db.setTable('briefing_items', [item('priorities', 1)]);
        deviceTables(db);
      },
    });
    await screen.findByTestId('briefing.deviceFreshness.stale');
    expect(
      screen.getByText(/^Apple Takvim · son eşitleme .+\. Sonraki değişiklikler/),
    ).toBeTruthy();
    expect(screen.queryByTestId('briefing.deviceFreshness.changed')).toBeNull();
  });

  it('says so when the schedule changed after the briefing and links the current plan', async () => {
    const { router } = await openApp({
      path: `/briefing/${ID.briefing}`,
      setup: (db) => {
        db.setTable('briefings', [briefingRow({ source_freshness: freshness() })]);
        db.setTable('briefing_items', [item('priorities', 1)]);
        deviceTables(db, VECTOR.events.slice(0, 1));
      },
    });
    await screen.findByTestId('briefing.deviceFreshness.changed');
    expect(screen.getByText('Takvimin bu brifingden sonra değişti.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Güncel programı gör'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
  });

  it('stays quiet when the device data was fresh and unchanged', async () => {
    await openApp({
      path: `/briefing/${ID.briefing}`,
      setup: (db) => {
        db.setTable('briefings', [
          briefingRow({ source_freshness: freshness(VECTOR.sha256, false) }),
        ]);
        db.setTable('briefing_items', [item('priorities', 1)]);
        deviceTables(db);
      },
    });
    await screen.findByTestId('briefing.section.priorities');
    expect(screen.queryByTestId(/^briefing\.deviceFreshness\./)).toBeNull();
  });
});

describe('staged morning opening (P:08)', () => {
  it('stages the hero and the sections on the first open only', async () => {
    await openApp({
      path: `/briefing/${ID.briefing}`,
      setup: (db) => {
        db.setTable('briefings', [briefingRow()]);
        db.setTable('briefing_items', [item('priorities', 1), item('deadlines', 2)]);
      },
    });
    expect(await screen.findByTestId('briefing.opening')).toBeOnTheScreen();
    expect(screen.getByTestId('briefing.section.priorities')).toBeOnTheScreen();
  });

  it('renders at rest once the briefing was opened', async () => {
    await openApp({
      path: `/briefing/${ID.briefing}`,
      setup: (db) => {
        db.setTable('briefings', [briefingRow({ opened_at: '2026-09-30T05:10:00Z' })]);
        db.setTable('briefing_items', [item('priorities', 1)]);
      },
    });
    await screen.findByTestId('briefing.section.priorities');
    expect(screen.queryByTestId('briefing.opening')).toBeNull();
  });
});

describe('audio mini player (DEV-52)', () => {
  async function startSpeech() {
    await act(async () => {
      startSession({
        briefingId: ID.briefing,
        kind: 'morning',
        title: 'Sabah Brifingi',
        autoplay: false,
        source: {
          kind: 'speech',
          language: 'tr-TR',
          chapters: [{ index: 0, title: 'Öncelikler', text: 'Bugün üç konu var.' }],
        },
      });
      await Promise.resolve();
    });
  }

  it('hides when the session stops', async () => {
    await openApp();
    await startSpeech();
    await screen.findByTestId('shell.miniPlayer');
    await act(async () => {
      stopSession();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('shell.miniPlayer')).toBeNull();
    });
  });

  it('docks above the tab bar, plays, expands to the full player and closes', async () => {
    const { router } = await openApp();
    expect(screen.queryByTestId('shell.miniPlayer')).toBeNull();
    await startSpeech();
    expect(await screen.findByTestId('shell.miniPlayer')).toBeOnTheScreen();
    expect(screen.getByText(/^Sabah Brifingi/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('ui.miniPlayer.playPause'));
    await waitFor(() => {
      expect(Speech.speak).toHaveBeenCalled();
    });
    expect(events('mini_player_action').at(-1)?.props).toEqual({ action: 'play' });

    await fireEvent.press(screen.getByTestId('ui.miniPlayer.expand'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/briefing/${ID.briefing}/listen`);
    });
    expect(events('mini_player_action').at(-1)?.props).toEqual({ action: 'expand' });
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await screen.findByTestId('shell.miniPlayer');
    await fireEvent.press(screen.getByLabelText('Sesli brifingi kapat'));
    await waitFor(() => {
      expect(screen.queryByTestId('shell.miniPlayer')).toBeNull();
    });
    expect(events('mini_player_action').at(-1)?.props).toEqual({ action: 'close' });
  });
});
