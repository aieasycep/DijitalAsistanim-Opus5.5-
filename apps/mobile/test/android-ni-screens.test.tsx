/**
 * T-8.26 screens: M-ANI-01 settings (iOS guard UT-MB-11, live status, disclosure → system handoff →
 * grant, the `android_ni` registration mirror, mode and categories, recent signals with single
 * and "Tümünü sil" deletes, Free gate, unsupported device), M-ANI-02 (the timestamp is stored, the
 * messaging row is not toggleable), M-ANI-03 picker, M-ANI-04 groups, the hub and permissions
 * rows, and the onboarding step M-ON-14A (Free gate, grant check, payloads per mode).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { AppState } from 'react-native';

import type * as Clock from '../src/lib/clock';
import { encryptedStorage } from '../src/lib/storage';
import { allowedPackagesFor, DEFAULT_CATEGORIES } from '../src/features/android-ni/presets';
import { json, resetAppState, type RecordedCall } from './helpers/app';
import { ok } from './helpers/fixtures';
import type { PostgrestFake } from './helpers/postgrest';
import {
  appRouter,
  events,
  onboardingBootstrap,
  openApp,
  PRO_ENTITLEMENT,
  proBootstrap,
} from './helpers/journeys';
import { asAndroid, hash, installFakeNi, niSignal, restorePlatform } from './helpers/ni';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

jest.mock('../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../src/lib/clock'),
  now: () => new Date('2027-01-10T09:00:00Z'),
}));

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

type ChangeHandler = (state: string) => void;
// The React Native jest preset mocks AppState with jest.fn listeners.
const appStateMock = (
  AppState as unknown as {
    readonly addEventListener: jest.Mock<
      (event: string, handler: ChangeHandler) => { remove: () => void }
    >;
  }
).addEventListener;
let appStateMark = 0;

/** Fires the AppState listeners registered since the test started and not removed since. */
async function returnToApp(): Promise<void> {
  await act(async () => {
    appStateMock.mock.calls.forEach(([event, handler], i) => {
      if (i < appStateMark || event !== 'change') return;
      const subscription = appStateMock.mock.results[i]?.value as { remove: jest.Mock } | undefined;
      if (subscription !== undefined && subscription.remove.mock.calls.length > 0) return;
      handler('active');
    });
    await Promise.resolve();
  });
}

function registerBodies(calls: readonly RecordedCall[]) {
  return calls
    .filter((c) => c.url.endsWith('/devices/register'))
    .map((c) => (c.body as { android_ni?: Record<string, unknown> }).android_ni);
}

beforeEach(async () => {
  await resetAppState();
  appStateMark = appStateMock.mock.calls.length;
});

afterEach(() => {
  restorePlatform();
});

describe('M-ANI-01 on iOS', () => {
  it('redirects to the hub (UT-MB-11)', async () => {
    const { router } = await openApp({ data: proBootstrap(), path: PATH });
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings');
    });
    expect(screen.queryByTestId('screen.settings.androidNi')).toBeNull();
    expect(screen.queryByTestId('hub.row.androidNi')).toBeNull();
  });
});

describe('M-ANI-01 on Android', () => {
  beforeEach(() => {
    asAndroid();
  });

  it('opens the disclosure first, then the system screen, and switches on after the grant', async () => {
    const ni = installFakeNi();
    const { router } = await openApp({
      data: proBootstrap(),
      path: '/settings',
      routes: { 'POST /devices/register': registerOk },
    });
    await fireEvent.press(await screen.findByTestId('hub.row.androidNi'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(PATH);
    });
    await screen.findByTestId('ani.status.notGranted');
    expect(screen.getByText('Bildirim erişimi kapalı')).toBeTruthy();
    expect(events('android_ni_opened')[0]?.props).toEqual({ state: 'not_granted' });
    expect(
      screen.getByText(
        'Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('ani.toggle')).toBeNull();

    await fireEvent.press(screen.getByText('Bildirim Erişimini Aç'));
    await screen.findByTestId('sheet.aniDisclosure');
    expect(events('android_ni_disclosure_viewed')).toHaveLength(1);
    // The messaging row is locked: no switch, pressing it changes nothing.
    await fireEvent.press(screen.getByTestId('aniDisclosure.messaging'));
    expect(events('android_ni_category_toggled')).toHaveLength(0);
    expect(ni.module.openSettings).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('aniDisclosure.accept'));
    expect(encryptedStorage().prefs.getString('ani.disclosure_accepted_at')).toBe(
      '2027-01-10T09:00:00.000Z',
    );
    expect(events('android_ni_disclosure_accepted')).toHaveLength(1);
    expect(events('android_ni_access_opened')).toHaveLength(1);
    expect(ni.module.openSettings).toHaveBeenCalledTimes(1);

    ni.state.granted = true;
    await returnToApp();
    await screen.findByTestId('ani.status.enabled');
    expect(ni.state.enabled).toBe(true);
    expect(events('android_ni_granted').at(-1)?.props).toEqual({ granted: true });
    expect(events('android_ni_enabled').at(-1)?.props).toEqual({ enabled: true });
    expect(screen.getByText('Açık · Son 24 saatte 0 sinyal')).toBeTruthy();
  });

  it('shows the restricted-settings help after two returns without a grant (KPL-02)', async () => {
    const ni = installFakeNi();
    encryptedStorage().prefs.set('ani.disclosure_accepted_at', '2027-01-01T00:00:00.000Z');
    await openAppWithCalls(PATH);
    await screen.findByTestId('ani.status.notGranted');
    for (let i = 0; i < 2; i += 1) {
      await fireEvent.press(screen.getByText('Bildirim Erişimini Aç'));
      await returnToApp();
    }
    expect(ni.module.openSettings).toHaveBeenCalledTimes(2);
    expect(events('android_ni_granted').map((e) => e.props)).toEqual([
      { granted: false },
      { granted: false },
    ]);
    await screen.findByTestId('ani.restrictedHelp');
    expect(
      screen.getByText(
        'İzin açılamıyorsa: Ayarlar → Uygulamalar → Dijital Asistan → ⋮ → Kısıtlı ayarlara izin ver, sonra tekrar dene.',
      ),
    ).toBeTruthy();
  });

  it('mirrors the switch and the mode to devices/register and edits categories', async () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    const { calls } = await openAppWithCalls(PATH);
    await screen.findByTestId('ani.status.enabled');
    expect(events('android_ni_opened')[0]?.props).toEqual({ state: 'enabled' });

    await fireEvent.press(screen.getByTestId('ani.category.reservation'));
    expect(events('android_ni_category_toggled').at(-1)?.props).toEqual({
      category: 'reservation',
      enabled: true,
    });
    await waitFor(() => {
      expect(registerBodies(calls).at(-1)).toEqual({
        available: true,
        listener_granted: true,
        enabled: true,
        mode: 'selected',
        allowed_packages: [...allowedPackagesFor({ ...DEFAULT_CATEGORIES, reservation: true }, [])],
      });
    });

    await fireEvent.press(screen.getByTestId('ani.mode.all'));
    expect(events('android_ni_mode_changed').at(-1)?.props).toEqual({ mode: 'all' });
    expect(ni.state.mode).toBe('all');
    await waitFor(() => {
      expect(registerBodies(calls).at(-1)).toMatchObject({ mode: 'all', allowed_packages: [] });
    });
    expect(screen.queryByTestId('ani.categories')).toBeNull();

    await fireEvent.press(screen.getByTestId('ani.toggle'));
    expect(ni.state.enabled).toBe(false);
    expect(events('android_ni_enabled').at(-1)?.props).toEqual({ enabled: false });
    await screen.findByTestId('ani.status.paused');
    expect(screen.getByText('Erişim açık, analiz kapalı')).toBeTruthy();
    await waitFor(() => {
      expect(registerBodies(calls).at(-1)).toMatchObject({ enabled: false });
    });
  });

  it('lists local and uploaded signals and deletes one or all', async () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    ni.buffer.push({ signal: niSignal(1), uploaded: false });
    const { db } = await openAppWithCalls(PATH, (fake) => {
      fake.setTable('android_notification_signals', [
        {
          package_name: 'com.garanti.cepsubesi',
          app_label: 'Garanti BBVA',
          category: 'bank_payment',
          amount: 1250.5,
          currency: 'TRY',
          due_date: '2027-01-15',
          tracking_status: null,
          flight_no: null,
          gate: null,
          posted_at: '2027-01-10T07:00:00+00:00',
          signal_hash: `\\x${hash(2)}`,
        },
      ]);
    });
    await screen.findByText('Açık · Son 24 saatte 2 sinyal');
    expect(screen.getByText('Trendyol · Kargo')).toBeTruthy();
    expect(screen.getByText('Garanti BBVA · Ödeme')).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`ani.signal.delete.${hash(2)}`));
    await waitFor(() => {
      expect(
        db.writes.some(
          (w) =>
            w.table === 'android_notification_signals' &&
            w.op === 'delete' &&
            w.filters.some(([col, , value]) => col === 'signal_hash' && value === `\\x${hash(2)}`),
        ),
      ).toBe(true);
    });
    expect(events('android_ni_signals_deleted').at(-1)?.props).toEqual({ scope: 'one' });
    expect(ni.module.deleteSignal).toHaveBeenCalledWith(hash(2));

    await fireEvent.press(screen.getByTestId('ani.deleteAll'));
    await screen.findByText('Tüm sinyaller silinsin mi?');
    await fireEvent.press(screen.getByText('Sil'));
    await waitFor(() => {
      expect(ni.module.clearBuffer).toHaveBeenCalled();
    });
    expect(events('android_ni_signals_deleted').at(-1)?.props).toEqual({ scope: 'all' });
    await waitFor(() => {
      expect(
        db.writes.filter((w) => w.table === 'android_notification_signals' && w.op === 'delete'),
      ).toHaveLength(2);
    });
  });

  it('shows the Pro gate to Free users and the unsupported state without the module', async () => {
    installFakeNi();
    await openApp({ path: PATH });
    await screen.findByTestId('ani.gate');
    expect(events('android_ni_opened')[0]?.props).toEqual({ state: 'not_entitled' });
    await fireEvent.press(screen.getByText('Bildirim Erişimini Aç'));
    expect(events('pro_gate_viewed').at(-1)?.props).toMatchObject({ feature: 'android_ni' });

    const ni = installFakeNi();
    ni.module.isAvailable.mockReturnValue(false);
    await act(async () => {
      appRouter.back();
      await Promise.resolve();
    });
    await act(async () => {
      appRouter.push(PATH);
      await Promise.resolve();
    });
    await screen.findByText('Bu cihaz bildirim erişimini desteklemiyor.');
  });

  it('shows the always-excluded groups and applies app picks (M-ANI-03, M-ANI-04)', async () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    await openAppWithCalls(PATH);
    await screen.findByTestId('ani.status.enabled');
    await fireEvent.press(screen.getByTestId('ani.locked'));
    await screen.findByTestId('sheet.aniDenylist');
    for (const group of [
      'authenticator',
      'password_manager',
      'e_devlet',
      'messaging',
      'google_play_services',
      'own_app',
    ]) {
      expect(screen.getByTestId(`aniDenylist.group.${group}`)).toBeTruthy();
    }
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(events('android_ni_denylist_viewed')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('aniDenylist.done'));

    await fireEvent.press(screen.getByTestId('ani.pickApps'));
    await screen.findByTestId('sheet.aniPicker');
    expect(screen.getByText('Son 7 günde 3 bildirim')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('aniPicker.app.com.getir'));
    await fireEvent.press(screen.getByTestId('aniPicker.done'));
    expect(events('android_ni_apps_selected').at(-1)?.props).toEqual({ count: 1 });
    expect(ni.state.allowedPackages).toContain('com.getir');
    expect(ni.state.allowedPackages).not.toContain('com.whatsapp');
  });

  it('sets per-app importance as an android_app priority rule (SREQ-62)', async () => {
    installFakeNi({ granted: true, enabled: true });
    const { db } = await openAppWithCalls(PATH);
    await screen.findByTestId('ani.status.enabled');
    await fireEvent.press(screen.getByTestId('ani.pickApps'));
    await fireEvent.press(await screen.findByTestId('aniPicker.app.com.getir'));
    const segment = await screen.findByTestId('aniPicker.importance.com.getir');
    await fireEvent.press(within(segment).getByText('Önemli'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        op: 'insert',
        values: {
          condition_type: 'android_app',
          condition_value: { package: 'com.getir' },
          outcome: 'always_important',
          applies_to: 'android_notification',
        },
      });
    });
    expect(events('priority_rule_created').at(-1)?.props).toEqual({
      condition_type: 'android_app',
      outcome: 'always_important',
    });
  });

  it('offers the "Uygulama" rule condition only with notification access (M-SET-51)', async () => {
    installFakeNi({ granted: true, enabled: true });
    const { db } = await openAppWithCalls('/settings/priority-rules/new');
    await fireEvent.press(await screen.findByTestId('rule.condition.android_app'));
    await fireEvent.press(screen.getByTestId('rule.app'));
    await fireEvent.press(await screen.findByTestId('ruleAppPicker.trendyol.com'));
    await fireEvent.press(screen.getByTestId('rule.save'));
    await waitFor(() => {
      expect(db.writes.at(-1)).toMatchObject({
        table: 'priority_rules',
        op: 'insert',
        values: {
          condition_type: 'android_app',
          condition_value: { package: 'trendyol.com' },
          applies_to: 'android_notification',
        },
      });
    });
  });

  it('hides the "Uygulama" rule condition without the grant', async () => {
    installFakeNi({ granted: false });
    await openAppWithCalls('/settings/priority-rules/new');
    await screen.findByTestId('rule.condition.domain');
    expect(screen.queryByTestId('rule.condition.android_app')).toBeNull();
  });

  it('links the permissions page row to the settings screen (M-SET-31)', async () => {
    installFakeNi({ granted: true, enabled: true });
    const { router } = await openAppWithCalls('/settings/privacy/permissions');
    await fireEvent.press(await screen.findByTestId('permissions.os.notificationAccess'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(PATH);
    });
  });
});

async function openAppWithCalls(path: string, setup?: (db: PostgrestFake) => void) {
  let captured: { db: PostgrestFake } | undefined;
  const calls: RecordedCall[] = [];
  const result = await openApp({
    data: proBootstrap(),
    path,
    setup: (db) => {
      captured = { db };
      setup?.(db);
    },
    routes: {
      'POST /devices/register': (call) => {
        calls.push(call);
        return registerOk();
      },
    },
  });
  if (captured === undefined) throw new Error('setup did not run');
  return { ...result, calls, db: captured.db };
}

describe('M-ON-14A on Android', () => {
  beforeEach(() => {
    asAndroid();
  });

  it('shows the Pro gate to Free users', async () => {
    installFakeNi();
    await openApp({
      data: onboardingBootstrap('android_notifications'),
      landing: '/android-notifications',
    });
    await screen.findByTestId('gate.android_ni');
    await fireEvent.press(screen.getByTestId('androidNi.skip'));
    expect(events('onboarding_skipped').at(-1)?.props).toEqual({ step: 'android_notifications' });
  });

  it('checks the real grant and mirrors the choice (selected with presets, all with none)', async () => {
    const ni = installFakeNi();
    const calls: RecordedCall[] = [];
    await openApp({
      data: onboardingBootstrap('android_notifications', { entitlement: PRO_ENTITLEMENT }),
      landing: '/android-notifications',
      routes: {
        'POST /devices/register': (call) => {
          calls.push(call);
          return registerOk();
        },
      },
    });
    await screen.findByTestId('androidNi.messaging');
    expect(events('android_ni_prompt_viewed')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('androidNi.open'));
    expect(ni.module.openSettings).toHaveBeenCalledTimes(1);
    expect(events('android_ni_access_opened')).toHaveLength(1);

    // Back without a grant: the notice and "Tekrar Dene".
    await returnToApp();
    await screen.findByTestId('androidNi.denied');
    expect(screen.getByText('Tekrar Dene')).toBeTruthy();
    expect(events('android_ni_result').at(-1)?.props).toEqual({ granted: false, mode: 'selected' });
    await waitFor(() => {
      expect(registerBodies(calls).at(-1)).toEqual({
        available: true,
        listener_granted: false,
        enabled: false,
        mode: 'selected',
        allowed_packages: [...allowedPackagesFor(DEFAULT_CATEGORIES, [])],
      });
    });

    // "Tüm uygulamalar", then the grant.
    await fireEvent.press(screen.getByText('Tüm uygulamalar'));
    expect(screen.queryByTestId('androidNi.category.shipping')).toBeNull();
    await fireEvent.press(screen.getByTestId('androidNi.open'));
    ni.state.granted = true;
    await returnToApp();
    await waitFor(() => {
      expect(registerBodies(calls).at(-1)).toEqual({
        available: true,
        listener_granted: true,
        enabled: true,
        mode: 'all',
        allowed_packages: [],
      });
    });
    expect(events('android_ni_result').at(-1)?.props).toEqual({ granted: true, mode: 'all' });
  });
});
