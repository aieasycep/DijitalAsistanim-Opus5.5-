/**
 * T-8.18 Smart Reminder sheet (M-REM-01): presets resolved on the device plus the server's
 * "Uygun zamanda" slot (API-REM-01), nothing created before the CTA, the in-app reminder
 * (local notification + `POST /reminders` with `channel: local`) and its undo, the notification
 * permission warning and the offline path (local notification now, sync later).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';

import { json, resetAppState } from './helpers/app';
import { M3 } from './helpers/assist';
import { TS, ok } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

const SHEET = `/reminders/new?targetType=insight&targetId=${M3.insight}&title=Faturay%C4%B1%20%C3%B6de&origin=today`;

function reminderResponse() {
  return {
    id: M3.reminder,
    title: 'Faturayı öde',
    preset: 'tomorrow_morning',
    fire_at: TS,
    time_zone: 'Europe/Istanbul',
    channel: 'local',
    status: 'scheduled',
    reason_text: null,
    subject: null,
    created_at: TS,
  };
}

function smartOption(valid: boolean) {
  const fireAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  return {
    options: [
      {
        preset: 'smart',
        fire_at: valid ? fireAt : null,
        label: valid ? 'Bugün' : '',
        reason_text: valid ? 'takvim boşluğu' : null,
        valid,
        invalid_reason: valid ? null : 'no_free_slot',
      },
    ],
  };
}

beforeEach(async () => {
  await resetAppState();
  jest.clearAllMocks();
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockImplementation(() => Promise.resolve({ status: 'granted', granted: true } as never));
});

describe('Smart Reminder sheet (M-REM-01)', () => {
  it('creates nothing before the CTA, then schedules locally, posts and undoes', async () => {
    const { api } = await openApp({
      path: SHEET,
      routes: {
        'POST /reminders/resolve-time': () => json(200, ok(smartOption(true))),
        'POST /reminders': () => json(201, ok(reminderResponse())),
        [`POST /reminders/${M3.reminder}/cancel`]: () =>
          json(200, ok({ ...reminderResponse(), status: 'cancelled' })),
      },
    });
    expect(await screen.findByText('Ne zaman hatırlatayım?')).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/reminders/resolve-time'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/resolve-time'))?.body).toEqual({
      presets: ['smart'],
    });
    await fireEvent.press(screen.getByTestId('reminder.preset.tomorrow_morning'));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/reminders'))).toBe(false);
    expect(events('reminder_sheet_open')[0]?.props).toEqual({ origin: 'today', mode: 'remind' });

    await fireEvent.press(screen.getByTestId('reminder.submit'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/reminders'))).toBe(true);
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const body = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/reminders'))
      ?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Faturayı öde',
      preset: 'tomorrow_morning',
      channel: 'local',
      origin: 'today',
    });
    const scheduled = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]?.[0];
    expect(scheduled?.identifier).toBe(`reminder:${String(body.client_reminder_id)}`);
    expect(events('reminder_created')[0]?.props).toEqual({
      preset: 'tomorrow_morning',
      destination: 'in_app',
      mode: 'remind',
      queued: false,
    });

    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/reminders/${M3.reminder}/cancel`))).toBe(true);
    });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      `reminder:${String(body.client_reminder_id)}`,
    );
    expect(events('reminder_undo')).toHaveLength(1);
  });

  it('marks "Uygun zamanda" unavailable when the server finds no slot', async () => {
    await openApp({
      path: SHEET,
      routes: {
        'POST /reminders/resolve-time': () => json(200, ok(smartOption(false))),
      },
    });
    expect(
      await screen.findByText('Bugün için uygun bir boşluk bulamadım; başka bir seçenek seç.'),
    ).toBeOnTheScreen();
    expect(events('reminder_smart_resolve')[0]?.props).toEqual({ result: 'no_slot' });
  });

  it('warns when notifications are off', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockImplementation(() => Promise.resolve({ status: 'denied', granted: false } as never));
    await openApp({
      path: SHEET,
      routes: { 'POST /reminders/resolve-time': () => json(200, ok(smartOption(true))) },
    });
    expect(await screen.findByTestId('reminder.permissionDenied')).toBeOnTheScreen();
  });

  it('offline: schedules the local notification now and syncs the reminder later', async () => {
    const { api } = await openApp({
      path: SHEET,
      routes: { 'POST /reminders': () => json(201, ok(reminderResponse())) },
    });
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByText('Bağlantı gerekli')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reminder.preset.tomorrow_morning'));
    await fireEvent.press(screen.getByTestId('reminder.submit'));
    await waitFor(() => {
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    });
    expect(events('reminder_created')[0]?.props).toMatchObject({ queued: true });
    expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/reminders'))).toBe(false);
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/reminders'))).toBe(true);
    });
  });
});
