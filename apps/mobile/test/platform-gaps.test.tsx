/**
 * Mobile platform gaps (KNOWN_PLATFORM_LIMITATIONS KPL-04/05/07/09/34/36/38): the `da-platform`
 * module interface and config plugin, the `platform_capabilities` of `POST /devices/register`,
 * the smart-reminder exact-alarm and Time Sensitive notes, the notification settings card and
 * delivery footnote, the Android listener health card ("Yeniden bağla", battery handoff), the
 * Sentry source-map switch, and the data-sources and Plan footnotes.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Linking, Platform } from 'react-native';

import {
  batteryOptimization,
  exactAlarmState,
  openBatteryOptimizationSettings,
  openExactAlarmSettings,
  openNotificationSettings,
  timeSensitiveSetting,
} from '../modules/da-platform/src';
import {
  EXACT_ALARM_PERMISSION,
  TIME_SENSITIVE_ENTITLEMENT,
  withDaPlatform,
} from '../modules/da-platform/plugin/withDaPlatform';
import { buildAppConfig, sentryUploadEnabled } from '../app.config';
import { cardFor } from '../src/features/android-ni/health';
import { deviceRegisterBody } from '../src/lib/device';
import { platformCapabilities } from '../src/lib/platform-capabilities';
import { json, resetAppState } from './helpers/app';
import { M3 } from './helpers/assist';
import { TS, googleAccount, ok } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';
import { asAndroid, installFakeNi, restorePlatform, type FakeNi } from './helpers/ni';
import type { PostgrestFake } from './helpers/postgrest';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

interface PlatformDouble {
  readonly __state: { exactAlarm: string; timeSensitive: string; battery: string };
  readonly getExactAlarmState: jest.Mock;
  readonly openExactAlarmSettings: jest.Mock;
  readonly getBatteryOptimization: jest.Mock;
  readonly openBatteryOptimizationSettings: jest.Mock;
  readonly getTimeSensitiveSetting: jest.Mock;
  readonly openNotificationSettings: jest.Mock;
}

const platformMock = jest.requireMock<{
  readonly __module: PlatformDouble;
  readonly nativePlatform: jest.Mock;
}>('../modules/da-platform/src/native');
const widgetsMock = jest.requireMock<{
  readonly __module: { readonly getInventory: jest.Mock };
  readonly nativeWidgets: jest.Mock;
}>('../modules/da-widgets/src/native');

const ORIGINAL_VERSION = Platform.Version;

function linkPlatform(state: Partial<PlatformDouble['__state']> = {}): PlatformDouble {
  Object.assign(platformMock.__module.__state, {
    exactAlarm: 'granted',
    timeSensitive: 'enabled',
    battery: 'optimized',
    ...state,
  });
  platformMock.nativePlatform.mockReturnValue(platformMock.__module);
  return platformMock.__module;
}

function androidVersion(version: number): void {
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

beforeEach(async () => {
  await resetAppState();
  jest.clearAllMocks();
  platformMock.nativePlatform.mockReturnValue(null);
  widgetsMock.nativeWidgets.mockReturnValue(null);
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockImplementation(() => Promise.resolve({ status: 'granted', granted: true } as never));
});

afterEach(() => {
  restorePlatform();
  Object.defineProperty(Platform, 'Version', { value: ORIGINAL_VERSION, configurable: true });
  platformMock.nativePlatform.mockReturnValue(null);
});

describe('da-platform interface (KPL-07, KPL-09)', () => {
  it('reads unknown without the native module and never guesses', async () => {
    expect(exactAlarmState()).toBe('not_required');
    expect(await timeSensitiveSetting()).toBeNull();
    asAndroid();
    expect(exactAlarmState()).toBeNull();
    expect(batteryOptimization()).toBeNull();
    expect(openExactAlarmSettings()).toBe(false);
    expect(openBatteryOptimizationSettings()).toBe(false);
    expect(await timeSensitiveSetting()).toBeNull();
  });

  it('reads the Android state and opens the settings through the module', () => {
    asAndroid();
    const module = linkPlatform({ exactAlarm: 'denied', battery: 'exempt' });
    expect(exactAlarmState()).toBe('denied');
    expect(batteryOptimization()).toBe('exempt');
    expect(openExactAlarmSettings()).toBe(true);
    expect(openBatteryOptimizationSettings()).toBe(true);
    expect(module.openExactAlarmSettings).toHaveBeenCalledTimes(1);
    expect(module.openBatteryOptimizationSettings).toHaveBeenCalledTimes(1);
    module.getExactAlarmState.mockImplementationOnce(() => {
      throw new Error('native');
    });
    expect(exactAlarmState()).toBeNull();
  });

  it('reads the iOS Time Sensitive setting and opens the notification settings', async () => {
    const module = linkPlatform({ timeSensitive: 'disabled' });
    expect(await timeSensitiveSetting()).toBe('disabled');
    expect(await openNotificationSettings()).toBe(true);
    expect(module.openNotificationSettings).toHaveBeenCalledTimes(1);
    module.getTimeSensitiveSetting.mockImplementationOnce(() => Promise.reject(new Error('x')));
    expect(await timeSensitiveSetting()).toBeNull();
    // Without the module (or when it fails) the app settings page is the handoff.
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    module.openNotificationSettings.mockImplementationOnce(() => Promise.resolve(false));
    expect(await openNotificationSettings()).toBe(true);
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRejectedValueOnce(new Error('no settings'));
    platformMock.nativePlatform.mockReturnValue(null);
    expect(await openNotificationSettings()).toBe(false);
    openSettings.mockRestore();
  });
});

describe('da-platform config plugin and app config', () => {
  it('declares the exact-alarm access and the Time Sensitive entitlement once', () => {
    const once = withDaPlatform({ name: 'x', slug: 'x', android: { permissions: ['CAMERA'] } });
    expect(once.android?.permissions).toEqual(['CAMERA', 'SCHEDULE_EXACT_ALARM']);
    expect(once.ios?.entitlements).toEqual({ [TIME_SENSITIVE_ENTITLEMENT]: true });
    const twice = withDaPlatform(once);
    expect(twice.android?.permissions).toEqual(['CAMERA', 'SCHEDULE_EXACT_ALARM']);
    expect(
      withDaPlatform({ name: 'x', slug: 'x', android: { permissions: [EXACT_ALARM_PERMISSION] } })
        .android?.permissions,
    ).toEqual([EXACT_ALARM_PERMISSION]);
  });

  it('refuses the Play-restricted permissions', () => {
    for (const permission of ['USE_EXACT_ALARM', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS']) {
      expect(() =>
        withDaPlatform({ name: 'x', slug: 'x', android: { permissions: [permission] } }),
      ).toThrow(/Play-restricted/);
    }
  });

  it('builds with the plugin, without Face ID, and uploads source maps only with a token', () => {
    const expo = buildAppConfig({}, { APP_ENV: 'production' });
    expect(expo.android?.permissions).toContain('SCHEDULE_EXACT_ALARM');
    expect(expo.ios?.entitlements?.[TIME_SENSITIVE_ENTITLEMENT]).toBe(true);
    expect(expo.ios?.infoPlist?.NSFaceIDUsageDescription).toBeUndefined();
    const names = (expo.plugins ?? []).map((p) => (typeof p === 'string' ? p : String(p[0])));
    expect(names).not.toContain('expo-local-authentication');
    const secure = (expo.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === 'expo-secure-store',
    ) as [string, { faceIDPermission: boolean }];
    expect(secure[1].faceIDPermission).toBe(false);
    const sentry = (expo.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === '@sentry/react-native/expo',
    ) as [string, { disableAutoUpload: boolean }];
    expect(sentry[1].disableAutoUpload).toBe(true);
    expect(sentryUploadEnabled({ SENTRY_AUTH_TOKEN: 'token' })).toBe(false);
    expect(sentryUploadEnabled({ SENTRY_AUTH_TOKEN: 'token', SENTRY_ORG: 'org' })).toBe(true);
    expect(sentryUploadEnabled({ SENTRY_AUTH_TOKEN: '', SENTRY_ORG: 'org' })).toBe(false);
    const upload = buildAppConfig(
      {},
      { APP_ENV: 'production', SENTRY_AUTH_TOKEN: 'token', SENTRY_ORG: 'org' },
    );
    const uploadSentry = (upload.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === '@sentry/react-native/expo',
    ) as [string, { disableAutoUpload: boolean }];
    expect(uploadSentry[1].disableAutoUpload).toBe(false);
  });
});

describe('platform capabilities (API-DEV-01)', () => {
  it('reports what iOS read and leaves unknown probes out', async () => {
    linkPlatform({ timeSensitive: 'disabled' });
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValueOnce({ status: 'granted', ios: { allowsPreviews: 1 } } as never);
    widgetsMock.nativeWidgets.mockReturnValue(widgetsMock.__module);
    widgetsMock.__module.getInventory.mockResolvedValueOnce({
      ios_families: 2 | 16,
      android_kinds: 0,
    } as never);
    expect(await platformCapabilities()).toEqual({
      ios_time_sensitive: false,
      ios_show_previews: true,
      background_task: true,
      widget_small: false,
      widget_medium: true,
      widget_large: false,
      widget_lock_inline: false,
      widget_lock_circular: true,
      widget_lock_rectangular: false,
      stt_on_device_tr: true,
      tts_tr_voice: true,
    });
    // Nothing readable: only the probes that answered.
    platformMock.nativePlatform.mockReturnValue(null);
    widgetsMock.nativeWidgets.mockReturnValue(null);
    expect(await platformCapabilities()).toEqual({
      background_task: true,
      stt_on_device_tr: true,
      tts_tr_voice: true,
    });
  });

  it('reports the Android exact alarms, listener and widgets', async () => {
    asAndroid();
    androidVersion(34);
    linkPlatform({ exactAlarm: 'denied' });
    const ni = installFakeNi({ granted: true, enabled: true });
    Object.assign(ni.module, {
      getListenerState: jest.fn(() => ({
        granted: true,
        connected: false,
        lastConnectedAt: null,
        lastEventAt: null,
        health: 'disconnected',
      })),
    });
    widgetsMock.nativeWidgets.mockReturnValue(widgetsMock.__module);
    widgetsMock.__module.getInventory.mockResolvedValueOnce({
      ios_families: 0,
      android_kinds: 2,
    } as never);
    expect(await platformCapabilities()).toMatchObject({
      exact_alarm: false,
      ni_available: true,
      ni_granted: true,
      ni_connected: false,
      widget_next: false,
      widget_today: true,
    });
  });

  it('is part of the registration body', async () => {
    const body = await deviceRegisterBody('00000000-0000-4000-8000-000000000001');
    expect(body.platform_capabilities).toMatchObject({ background_task: true });
  });
});

const SHEET = `/reminders/new?targetType=insight&targetId=${M3.insight}&title=Faturay%C4%B1%20%C3%B6de&origin=today`;

describe('smart reminder platform notes (KPL-07, KPL-09)', () => {
  it('explains the missing exact-alarm access on Android and opens its settings', async () => {
    asAndroid();
    androidVersion(34);
    const module = linkPlatform({ exactAlarm: 'denied' });
    await openApp({
      path: SHEET,
      routes: { 'POST /reminders/resolve-time': () => json(200, ok({ options: [] })) },
    });
    const note = await screen.findByTestId('reminder.exactAlarm');
    expect(
      screen.getByText(
        'Tam saatinde hatırlatabilmem için “Alarmlar ve hatırlatıcılar” iznini aç. Bu izin kapalıyken hatırlatıcı birkaç dakika gecikebilir.',
      ),
    ).toBeOnTheScreen();
    expect(note).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('İzni Aç'));
    expect(module.openExactAlarmSettings).toHaveBeenCalledTimes(1);
    expect(events('permission_row_tapped').at(-1)?.props).toEqual({
      permission: 'exact_alarm',
      state: 'denied',
    });
    expect(screen.queryByTestId('reminder.timeSensitive')).toBeNull();
  });

  it('shows no exact-alarm note when the access is granted', async () => {
    asAndroid();
    androidVersion(34);
    linkPlatform({ exactAlarm: 'granted' });
    await openApp({
      path: SHEET,
      routes: { 'POST /reminders/resolve-time': () => json(200, ok({ options: [] })) },
    });
    await screen.findByTestId('reminder.main');
    expect(screen.queryByTestId('reminder.exactAlarm')).toBeNull();
  });

  it('warns on iOS when Time Sensitive notifications are off', async () => {
    const module = linkPlatform({ timeSensitive: 'disabled' });
    await openApp({
      path: SHEET,
      routes: { 'POST /reminders/resolve-time': () => json(200, ok({ options: [] })) },
    });
    await screen.findByTestId('reminder.timeSensitive');
    expect(screen.getByText('Zamana Duyarlı Bildirimler kapalı')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Ayarları Aç'));
    expect(module.openNotificationSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reminder.exactAlarm')).toBeNull();
  });
});

describe('notification settings (KPL-05, KPL-07)', () => {
  it('shows the delivery footnote and the Time Sensitive card only when it is off', async () => {
    const module = linkPlatform({ timeSensitive: 'disabled' });
    await openApp({ path: '/settings/notifications' });
    expect(await screen.findByTestId('notifications.deliveryFootnote')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Bildirimler Apple ve Google'ın bildirim servisleri üzerinden iletilir. Telefonun kapalıyken ya da internete bağlı değilken bazıları gecikebilir veya yalnızca en sonuncusu ulaşabilir. Her şeyin güncel hâli Bugün ekranında.",
      ),
    ).toBeOnTheScreen();
    await screen.findByTestId('notifications.timeSensitive');
    await fireEvent.press(screen.getByText('Ayarları Aç'));
    expect(module.openNotificationSettings).toHaveBeenCalled();
  });

  it('hides the Time Sensitive card when the setting is on', async () => {
    linkPlatform({ timeSensitive: 'enabled' });
    await openApp({ path: '/settings/notifications' });
    await screen.findByTestId('notifications.deliveryFootnote');
    expect(screen.queryByTestId('notifications.timeSensitive')).toBeNull();
  });
});

describe('Android listener health (KPL-04)', () => {
  const PATH = '/settings/android-notifications';
  const registerOk = () =>
    json(
      200,
      ok({
        installation_id: '00000000-0000-4000-8000-000000000099',
        push_enabled: false,
        rebound_from_other_user: false,
        timezone_applied: false,
      }),
    );

  function withListener(
    ni: FakeNi,
    listener: { connected: boolean; health: string; lastEventAt?: string | null },
    rebind: () => boolean,
  ) {
    const state = {
      granted: true,
      connected: listener.connected,
      lastConnectedAt: null,
      lastEventAt: listener.lastEventAt ?? null,
      health: listener.health,
    };
    const getListenerState = jest.fn(() => ({ ...state }));
    const requestRebind = jest.fn(rebind);
    Object.assign(ni.module, { getListenerState, requestRebind });
    return { state, getListenerState, requestRebind };
  }

  it('maps the module verdict to the card', () => {
    expect(cardFor(null)).toBe('hidden');
    const base = { granted: true, connected: true, lastConnectedAt: null, lastEventAt: null };
    expect(cardFor({ ...base, health: 'healthy' })).toBe('hidden');
    expect(cardFor({ ...base, health: 'stale' })).toBe('stale');
    expect(cardFor({ ...base, connected: false, health: 'disconnected' })).toBe('disconnected');
  });

  it('rebinds, shows the card when the listener stays unbound and clears it on reconnect', async () => {
    asAndroid();
    const module = linkPlatform({ battery: 'optimized' });
    const ni = installFakeNi({ granted: true, enabled: true, allowedPackages: ['trendyol.com'] });
    const listener = withListener(ni, { connected: false, health: 'disconnected' }, () => false);
    await openApp({
      data: proBootstrap(),
      path: PATH,
      routes: { 'POST /devices/register': registerOk },
    });
    // The automatic rebind could not be requested: the card reports the unbound listener.
    await screen.findByTestId('ani.health.disconnected');
    expect(listener.requestRebind).toHaveBeenCalled();
    expect(screen.getByText('Bildirim erişimi açık ama bağlantı koptu')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Pil ayarlarını aç'));
    expect(module.openBatteryOptimizationSettings).toHaveBeenCalledTimes(1);

    // "Yeniden bağla": the request goes out and the card shows progress until the verdict.
    listener.requestRebind.mockImplementation(() => true);
    await fireEvent.press(screen.getByText('Yeniden bağla'));
    await screen.findByTestId('ani.health.checking');
    listener.state.connected = true;
    listener.state.health = 'healthy';
    await act(async () => {
      ni.emit('onListenerChanged' as never);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByTestId(/^ani\.health\./)).toBeNull();
    });
  });

  it('flags a silent listener and omits the battery handoff when already exempt', async () => {
    asAndroid();
    linkPlatform({ battery: 'exempt' });
    const ni = installFakeNi({ granted: true, enabled: true, allowedPackages: ['trendyol.com'] });
    withListener(
      ni,
      { connected: true, health: 'stale', lastEventAt: '2027-01-08T08:00:00.000Z' },
      () => true,
    );
    await openApp({
      data: proBootstrap(),
      path: PATH,
      routes: { 'POST /devices/register': registerOk },
    });
    await screen.findByTestId('ani.health.stale');
    expect(screen.queryByText('Pil ayarlarını aç')).toBeNull();
  });

  it('toasts when no battery settings screen opens', async () => {
    asAndroid();
    const module = linkPlatform({ battery: 'optimized' });
    module.openBatteryOptimizationSettings.mockImplementationOnce(() => false);
    const ni = installFakeNi({ granted: true, enabled: true, allowedPackages: ['trendyol.com'] });
    withListener(ni, { connected: true, health: 'stale' }, () => true);
    await openApp({
      data: proBootstrap(),
      path: PATH,
      routes: { 'POST /devices/register': registerOk },
    });
    await screen.findByTestId('ani.health.stale');
    await fireEvent.press(screen.getByText('Pil ayarlarını aç'));
    expect(await screen.findByText('Ayarlar açılamadı.')).toBeOnTheScreen();
  });
});

function accountRow(provider: string, capabilities: readonly string[], id = googleAccount.id) {
  return {
    id,
    provider,
    account_email: `${provider}@example.com`,
    display_label: null,
    status: 'healthy',
    status_reason: null,
    capabilities_granted: capabilities,
    granted_scopes: [],
    data_source_toggles: googleAccount.data_sources,
    last_sync_at: null,
    last_error_code: null,
    updated_at: TS,
  };
}

describe('limit footnotes (KPL-34, KPL-36, KPL-38)', () => {
  it('states the analysed folders per mail account and the task polling cadence', async () => {
    await openApp({
      path: '/settings/privacy/data-sources',
      setup: (db) => {
        db.setTable('connected_accounts', [
          accountRow('google', ['mail_read', 'tasks_read']),
          accountRow('microsoft', ['mail_read'], '00000000-0000-4000-8000-0000000000a2'),
          accountRow('apple_device', ['calendar_read'], '00000000-0000-4000-8000-0000000000a3'),
        ]);
      },
    });
    expect(
      await screen.findByText(
        'Gelen Kutusu ve Gönderilenler analiz edilir. Filtreyle gelen kutusuna uğramadan arşivlenen mailler dahil edilmez.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Gelen Kutusu ve Gönderilmiş Öğeler analiz edilir. Kurallarla başka klasöre taşınan mailler dahil edilmez.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('dataSources.tasksPoll')).toBeOnTheScreen();
  });

  it('leaves the task footnote out without a task list', async () => {
    await openApp({
      path: '/settings/privacy/data-sources',
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow('google', ['mail_read'])]);
      },
    });
    await screen.findByTestId(`dataSources.account.${googleAccount.id}`);
    expect(screen.queryByTestId('dataSources.tasksPoll')).toBeNull();
  });

  it('notes Plan days past a connected calendar sync window', async () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const setup = (db: PostgrestFake) => {
      db.setTable('connected_accounts', [accountRow('microsoft', ['calendar_read'])]);
    };
    await openApp({ path: `/plan?date=${day(90)}`, setup });
    expect(await screen.findByTestId('plan.outsideWindow')).toBeOnTheScreen();
    expect(
      screen.getByText('Bu tarih eşitleme aralığının dışında; etkinlikler yaklaştıkça görünür.'),
    ).toBeOnTheScreen();
  });

  it('shows no note inside the window', async () => {
    const inside = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await openApp({
      path: `/plan?date=${inside}`,
      setup: (db) => {
        db.setTable('connected_accounts', [accountRow('microsoft', ['calendar_read'])]);
      },
    });
    await screen.findByTestId('plan.screen');
    expect(screen.queryByTestId('plan.outsideWindow')).toBeNull();
  });
});

describe('tab bar material (DEV-20)', () => {
  it('blurs the iOS tab bar', async () => {
    await openApp();
    expect(await screen.findByTestId('shell.tabBar.blur')).toBeOnTheScreen();
  });

  it('keeps the bar opaque with Reduce Transparency', async () => {
    const reduce = jest
      .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
      .mockResolvedValue(true);
    await openApp();
    await screen.findByTestId('shell.tabBar');
    await waitFor(() => {
      expect(screen.queryByTestId('shell.tabBar.blur')).toBeNull();
    });
    reduce.mockRestore();
  });

  it('keeps the bar opaque on Android', async () => {
    asAndroid();
    await openApp();
    await screen.findByTestId('shell.tabBar');
    expect(screen.queryByTestId('shell.tabBar.blur')).toBeNull();
  });
});
