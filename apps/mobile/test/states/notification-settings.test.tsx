/**
 * T-8.19 · M-SET-20 Bildirimler (SCREEN_AND_FLOW_MAP M-SET-20, API_CONTRACTS `POST
 * /notifications/test`, R-13/R-14): the permission banner per OS state (denied, provisional,
 * undetermined → prompt → `POST /devices/register`), the iOS previews row, every switch written to
 * `notification_preferences` / `user_preferences`, a briefing slot that is off, the detail levels,
 * each test-notification outcome, and the quiet-hours sheet (times, same-time error, disabling,
 * the Free VIP-bypass gate).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { resetPendingSettingsForTests } from '../../src/features/settings/save';
import { json, resetAppState, type Responder } from '../helpers/app';
import { bootstrap, errorBody, ok, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';

type Permission = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;

function permission(status: string, ios?: Record<string, number>): Permission {
  return { status, granted: status === 'granted', ...(ios === undefined ? {} : { ios }) } as never;
}

function openNotifications(
  options: {
    data?: ReturnType<typeof bootstrap>;
    routes?: Record<string, Responder>;
    path?: string;
  } = {},
) {
  return openApp({
    data: options.data ?? proBootstrap(),
    path: options.path ?? '/settings/notifications',
    ...(options.routes === undefined ? {} : { routes: options.routes }),
  });
}

beforeEach(async () => {
  await resetAppState();
  resetPendingSettingsForTests();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('granted'));
});

describe('M-SET-20 · permission banner', () => {
  it('sends a denied user to the system settings', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('denied'));
    const openSettings = jest.spyOn(Linking, 'openSettings');
    await openNotifications();
    const banner = await screen.findByTestId('notifications.banner');
    expect(within(banner).getByText('Bildirimler kapalı')).toBeOnTheScreen();
    expect(screen.getByText('Bildirim izni olmadan bu ayarlar uygulanmaz.')).toBeOnTheScreen();
    await fireEvent.press(within(banner).getByText('Ayarları Aç'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('offers full permission for a provisional grant and shows the iOS preview setting', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue(permission('granted', { status: 3, allowsPreviews: 2 }));
    const openSettings = jest.spyOn(Linking, 'openSettings');
    openSettings.mockClear();
    await openNotifications();
    await fireEvent.press(await screen.findByText('Tam izin ver'));
    expect(screen.getByTestId('notifications.iosPreviews')).toHaveTextContent(/Kilit açıkken/);
    await fireEvent.press(screen.getByTestId('notifications.iosPreviews'));
    expect(openSettings).toHaveBeenCalledTimes(2);
  });

  it('prompts when undetermined, registers the device and hides the banner', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('undetermined'));
    const { api } = await openNotifications({
      routes: {
        'POST /devices/register': () =>
          json(200, ok({ installation_id: uuid(2400), registered_at: '2026-09-24T06:30:00Z' })),
      },
    });
    await screen.findByText('Bildirim izni verilmedi');
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('granted'));
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission('granted'));
    await fireEvent.press(screen.getByText('Bildirimlere İzin Ver'));
    await waitFor(() => {
      expect(screen.queryByTestId('notifications.banner')).toBeNull();
    });
    expect(events('notification_permission_prompted').at(-1)?.props).toEqual({
      result: 'granted',
    });
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/devices/register'))).toBe(true);
    });
  });
});

describe('M-SET-20 · preferences', () => {
  it('writes the smart filter, weekly review, lock screen and detail level', async () => {
    const data = proBootstrap();
    const { db } = await openNotifications({
      data: {
        ...data,
        notification_preferences: { ...data.notification_preferences, lock_screen_private: false },
      },
    });
    await fireEvent.press(await screen.findByTestId('notifications.smartFilter'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'notification_preferences',
        values: { smart_filter: !data.notification_preferences.smart_filter },
      });
    });
    await fireEvent.press(screen.getByTestId('notifications.weekly'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'user_preferences',
        values: { weekly_enabled: !data.preferences.weekly_enabled },
      });
    });
    await fireEvent.press(screen.getByTestId('notifications.lockScreen'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ lock_screen_private: true });
    });
    const before = db.writes.length;
    // The selected level is a no-op; another level is written without a confirmation.
    await fireEvent.press(
      screen.getByTestId(`notifications.detail.${data.notification_preferences.detail_level}`),
    );
    expect(db.writes).toHaveLength(before);
    await fireEvent.press(screen.getByTestId('notifications.detail.full'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ detail_level: 'full' });
    });
    expect(events('lock_screen_private_changed').at(-1)?.props).toEqual({ enabled: true });
    expect(events('notification_smart_filter_changed')).toHaveLength(1);
  });

  it('sends an off briefing slot to the briefing settings', async () => {
    const data = proBootstrap();
    const { router } = await openNotifications({
      data: { ...data, preferences: { ...data.preferences, midday_enabled: false } },
    });
    const row = await screen.findByTestId('notifications.midday');
    expect(row).toHaveTextContent(/Brifing kapalı · Brifing ayarlarından aç/);
    await fireEvent.press(row);
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/briefings');
    });
  });

  it('keeps the confirmation sheet for full content dismissible', async () => {
    const { db } = await openNotifications();
    await fireEvent.press(await screen.findByTestId('notifications.detail.full'));
    const sheet = await screen.findByTestId('sheet.fullDetail');
    await fireEvent.press(within(sheet).getByText('Vazgeç'));
    await waitFor(() => {
      expect(screen.queryByTestId('fullDetail.apply')).toBeNull();
    });
    expect(db.writes.filter((w) => w.table === 'notification_preferences')).toHaveLength(0);
  });
});

describe('M-SET-20 · test notification', () => {
  it.each([
    [
      'sent',
      () =>
        json(
          202,
          ok({
            notification_id: uuid(2401),
            job: { job_id: uuid(2402), status: 'queued', poll_after_ms: 1000 },
            deferred_until: null,
          }),
        ),
      'Test bildirimi gönderildi. Birkaç saniye içinde gelmesi gerekir.',
      null,
    ],
    [
      'rate limited',
      () => json(429, errorBody('RATE_LIMITED')),
      'Kısa süre içinde çok fazla test gönderildi. Biraz sonra tekrar dene.',
      'rate_limited',
    ],
    [
      'without a device',
      () => json(409, errorBody('STATE_CONFLICT')),
      'Bu cihazda bildirim izni yok.',
      'no_device',
    ],
    ['failed', () => json(422, errorBody('VALIDATION_FAILED')), 'Bir sorun oluştu.', null],
  ])('reports a %s test', async (_name, respond, text, reason) => {
    await openNotifications({ routes: { 'POST /notifications/test': respond } });
    await fireEvent.press(await screen.findByTestId('notifications.test'));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    if (reason !== null) {
      expect(events('notification_test_blocked').at(-1)?.props).toEqual({ reason });
    }
  });
});

describe('M-SET-20 · quiet hours', () => {
  it('changes the start, keeps the end on cancel, then turns quiet hours off', async () => {
    const { db } = await openNotifications();
    await fireEvent.press(await screen.findByTestId('notifications.quietHours'));
    const sheet = await screen.findByTestId('sheet.quietHours');
    await fireEvent.press(within(sheet).getByTestId('quietHours.start'));
    await fireEvent.press(await screen.findByTestId('time.hour.up'));
    await fireEvent.press(screen.getByTestId('time.done'));
    await waitFor(() => {
      expect(screen.getByTestId('quietHours.start')).toHaveTextContent('23:30');
    });
    // Dismissing the picker keeps the end time.
    await fireEvent.press(screen.getByTestId('quietHours.end'));
    await fireEvent.press(within(await screen.findByTestId('sheet.time')).getByText('Vazgeç'));
    await waitFor(() => {
      expect(screen.queryByTestId('sheet.time')).toBeNull();
    });
    expect(screen.getByTestId('quietHours.end')).toHaveTextContent('07:30');
    await fireEvent.press(screen.getByTestId('quietHours.day.1'));
    await fireEvent.press(screen.getByTestId('quietHours.vip'));
    await fireEvent.press(screen.getByTestId('quietHours.enabled'));
    expect(screen.queryByTestId('quietHours.start')).toBeNull();
    await fireEvent.press(screen.getByTestId('quietHours.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'notification_preferences',
        values: { quiet_hours_enabled: false, quiet_start: '23:30', vip_bypass_quiet: false },
      });
    });
    expect(events('quiet_hours_changed').at(-1)?.props).toEqual({
      enabled: false,
      days_count: 6,
      vip_bypass: false,
    });
  });

  it('refuses a window that starts and ends at the same time', async () => {
    const data = proBootstrap();
    await openNotifications({
      data: {
        ...data,
        notification_preferences: {
          ...data.notification_preferences,
          quiet_start: '22:00',
          quiet_end: '22:00',
          quiet_days: [],
        },
      },
      path: '/settings/notifications?sheet=quiet-hours',
    });
    expect(await screen.findByTestId('quietHours.invalid')).toHaveTextContent(
      'Başlangıç ve bitiş aynı olamaz.',
    );
    expect(screen.getByTestId('quietHours.save')).toBeDisabled();
  });

  it('gates the VIP bypass on Free', async () => {
    await openNotifications({
      data: bootstrap(),
      path: '/settings/notifications?sheet=quiet-hours',
    });
    await fireEvent.press(await screen.findByTestId('quietHours.vip'));
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'vip' });
  });
});
