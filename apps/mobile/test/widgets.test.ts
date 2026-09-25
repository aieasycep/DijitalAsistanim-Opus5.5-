/**
 * Widgets (T-8.25; SCREEN_AND_FLOW_MAP §11): the snapshot bridge (fetch, privacy ceiling, variant
 * scheme, floors, etag, sign-out), the widget deep-link analytics, the config plugin, the golden
 * preview (CT-09, JS side), UT-WID-01 (generic → counts only) and the generated native sources
 * (drift, catalog keys and colour tokens the Swift / Kotlin code references).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { qk } from '@da/api-client';
import {
  WIDGET_SNAPSHOT_MAX_BYTES,
  WidgetSnapshotV1,
  signedOutWidgetSnapshot,
} from '@da/validation/widget-snapshot';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as ConfigPlugins from 'expo/config-plugins';
import { AppState, type AppStateStatus } from 'react-native';

import { redirectSystemPath } from '../app/+native-intent';
import {
  WIDGET_NATIVE_FILES,
  flattenMessage,
  generateWidgetNative,
  trLocativeTables,
} from '../modules/da-widgets/plugin/generate-native';
import {
  WIDGET_RECEIVERS,
  createWithDaWidgets,
  type DaWidgetsMods,
} from '../modules/da-widgets/plugin/withDaWidgets';
import * as DaWidgets from '../modules/da-widgets/src';
import { saveNotificationPreferences } from '../src/features/settings/save';
import { bindWidgetRefresh } from '../src/features/widgets/WidgetBridge';
import { widgetOpenFromHref, widgetTarget } from '../src/features/widgets/analytics';
import {
  FOREGROUND_FLOOR_MS,
  applyLocalWidgetPrivacy,
  clearWidgetSnapshot,
  refreshWidgetSnapshot,
  resetWidgetBridgeForTests,
  withAppScheme,
} from '../src/features/widgets/snapshot';
import { logout } from '../src/lib/auth/logout';
import {
  BACKGROUND_REFRESH_TASK,
  runBackgroundRefresh,
  scheduleBackgroundRefresh,
} from '../src/lib/background-refresh';
import { getQueryClient } from '../src/lib/query/client';
import { installApi, json, resetAppState, type Responder } from './helpers/app';
import { bootstrap, ok } from './helpers/fixtures';
import { events } from './helpers/journeys';

const APP_ROOT = join(__dirname, '..');
const REPO_ROOT = join(APP_ROOT, '..', '..');

interface NativeDouble {
  readonly __store: { snapshot: string | null; scheme: string | null };
  readonly setSnapshot: jest.Mock;
  readonly reload: jest.Mock;
  readonly getInventory: jest.Mock;
}
const native = jest.requireMock<{ __module: NativeDouble; nativeWidgets: jest.Mock }>(
  '../modules/da-widgets/src/native',
);

const golden = JSON.parse(
  readFileSync(join(APP_ROOT, 'targets/widget/golden/preview.json'), 'utf8'),
) as WidgetSnapshotV1;

function stored(): WidgetSnapshotV1 | null {
  const raw = native.__module.__store.snapshot;
  return raw === null ? null : (JSON.parse(raw) as WidgetSnapshotV1);
}

function withPreferences(detail_level: 'full' | 'title_only' | 'generic', lockPrivate = false) {
  const base = bootstrap();
  getQueryClient().setQueryData(
    qk.me.bootstrap(),
    bootstrap({
      notification_preferences: {
        ...base.notification_preferences,
        detail_level,
        lock_screen_private: lockPrivate,
      },
    }),
  );
}

function serve(...snapshots: unknown[]) {
  let call = 0;
  const responder: Responder = () => {
    const body = snapshots[Math.min(call, snapshots.length - 1)];
    call += 1;
    return json(200, ok(body));
  };
  return installApi({ 'GET /widgets/snapshot': responder });
}

beforeEach(async () => {
  await resetAppState();
  resetWidgetBridgeForTests();
  native.nativeWidgets.mockReturnValue(native.__module);
  native.__module.__store.snapshot = null;
  native.__module.__store.scheme = null;
  native.__module.setSnapshot.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WidgetSnapshotV1 golden preview (CT-09, JS side)', () => {
  it('is a valid Pro full-mode snapshot within the 8 KB budget', () => {
    expect(WidgetSnapshotV1.safeParse(golden).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(golden), 'utf8')).toBeLessThan(
      WIDGET_SNAPSHOT_MAX_BYTES,
    );
  });
});

describe('snapshot bridge (§11.2–§11.4)', () => {
  it('writes the fetched snapshot with this build’s scheme and redraws', async () => {
    withPreferences('full');
    const api = serve(golden);
    await expect(refreshWidgetSnapshot('foreground')).resolves.toBe('ok');
    expect(api.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /functions/v1/api/widgets/snapshot',
    ]);
    const written = stored();
    expect(native.__module.__store.scheme).toBe('dijitalasistan-dev');
    expect(written?.priorities[0]?.deeplink).toBe(
      'dijitalasistan-dev://mail/00000000-0000-4000-8000-000000000a01',
    );
    expect(written?.briefing?.deeplink.startsWith('dijitalasistan-dev://briefing/')).toBe(true);
    expect(events('widget_snapshot_refreshed').map((e) => e.props)).toEqual([
      { trigger: 'foreground', result: 'ok' },
    ]);
  });

  it('UT-WID-01: a generic local level caps a fuller server snapshot to counts only', async () => {
    withPreferences('generic');
    serve(golden);
    await refreshWidgetSnapshot('settings', { force: true });
    const written = stored();
    expect(written?.detail_mode).toBe('generic');
    const text = JSON.stringify(written);
    for (const name of ['Ahmet', 'Mehmet', 'Zeynep', 'Başvuru', 'Gmail']) {
      expect(text).not.toContain(name);
    }
    expect(written?.counts.important).toBe(5);
    expect(WidgetSnapshotV1.safeParse(written).success).toBe(true);
  });

  it('keeps lock-screen privacy on when the device setting asks for it', async () => {
    withPreferences('full', true);
    serve(golden);
    await refreshWidgetSnapshot('login', { force: true });
    expect(stored()?.lock_screen_private).toBe(true);
    expect(stored()?.detail_mode).toBe('full');
  });

  it('respects the foreground floor, coalesces and skips an unchanged etag', async () => {
    withPreferences('full');
    serve(golden, golden);
    await refreshWidgetSnapshot('foreground');
    await expect(refreshWidgetSnapshot('foreground')).resolves.toBe('skipped');
    await expect(refreshWidgetSnapshot('push')).resolves.toBe('skipped');
    await expect(refreshWidgetSnapshot('settings', { force: true })).resolves.toBe('not_modified');
    expect(native.__module.setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a Today refetch past 30 s and on the next foreground after 5 min', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-09-24T08:00:00Z'));
    withPreferences('full');
    serve(golden, { ...golden, etag: 'refetch' }, { ...golden, etag: 'next' });
    await refreshWidgetSnapshot('foreground');
    jest.setSystemTime(new Date(Date.now() + 31_000));
    await expect(refreshWidgetSnapshot('foreground')).resolves.toBe('skipped');
    await expect(refreshWidgetSnapshot('foreground', { afterRefetch: true })).resolves.toBe('ok');
    jest.setSystemTime(new Date(Date.now() + FOREGROUND_FLOOR_MS + 1_000));
    await expect(refreshWidgetSnapshot('foreground')).resolves.toBe('ok');
    expect(native.__module.setSnapshot).toHaveBeenCalledTimes(3);
  });

  it('skips offline and reports a failed fetch without writing', async () => {
    onlineManager.setOnline(false);
    await expect(refreshWidgetSnapshot('push')).resolves.toBe('skipped');
    onlineManager.setOnline(true);
    installApi({ 'GET /widgets/snapshot': () => json(500, { error: 'boom' }) });
    await expect(refreshWidgetSnapshot('push')).resolves.toBe('failed');
    expect(stored()).toBeNull();
    expect(events('widget_snapshot_refreshed').at(-1)?.props).toEqual({
      trigger: 'push',
      result: 'failed',
    });
  });

  it('rejects a snapshot outside the schema before it reaches the store', async () => {
    await expect(
      DaWidgets.setSnapshot({ ...golden, priorities: [{ body: 'Merhaba' }] }, 'dijitalasistan'),
    ).rejects.toThrow();
    await expect(DaWidgets.setSnapshot(golden, 'Not A Scheme')).rejects.toThrow('invalid_scheme');
    expect(native.__module.setSnapshot).not.toHaveBeenCalled();
  });

  it('re-filters the stored snapshot at once when the level is lowered offline', async () => {
    withPreferences('full');
    serve(golden);
    await refreshWidgetSnapshot('foreground');
    onlineManager.setOnline(false);
    await saveNotificationPreferences({ detail_level: 'title_only' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(applyLocalWidgetPrivacy()).resolves.toBe(false);
    const written = stored();
    expect(written?.detail_mode).toBe('title_only');
    expect(written?.priorities[0]?.title_full).toBeUndefined();
    expect(written?.priorities[0]?.title_private).toBe('Yanıt bekleyen önemli mail');
    onlineManager.setOnline(true);
  });

  it('writes the signed-out snapshot on logout and drops a fetch still in flight', async () => {
    withPreferences('full');
    let release: (() => void) | undefined;
    installApi({
      'GET /widgets/snapshot': () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(200, ok(golden)));
          };
        }),
    });
    const pending = refreshWidgetSnapshot('foreground');
    for (let i = 0; i < 50 && release === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await clearWidgetSnapshot();
    expect(release).toBeDefined();
    release?.();
    await expect(pending).resolves.toBe('skipped');
    expect(stored()?.state).toBe('signed_out');
    expect(stored()?.priorities).toEqual([]);
  });

  it('runs as the logout after-wipe hook (CTL-3.13)', async () => {
    native.__module.__store.snapshot = JSON.stringify(golden);
    await logout(
      {},
      {
        api: installApi({}).client,
        supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } } as never,
        installationId: () => null,
        wipeStorage: () => Promise.resolve(),
        unregisterPush: () => Promise.resolve(),
        cancelLocalNotifications: () => Promise.resolve(),
        isOffline: () => false,
      },
    );
    const written = stored();
    expect(written?.state).toBe('signed_out');
    expect(written).toEqual(
      signedOutWidgetSnapshot(new Date(written?.generated_at ?? 0), written?.locale ?? 'tr'),
    );
  });

  it('rewrites only app links to the variant scheme', () => {
    const relinked = withAppScheme(golden, 'dijitalasistan-preview');
    expect(relinked.follow_up?.deeplink).toBe(
      'dijitalasistan-preview://followups?focus=00000000-0000-4000-8000-000000000c02',
    );
    expect(withAppScheme(golden, 'dijitalasistan')).toBe(golden);
  });

  it('is inert where the native module is not linked', async () => {
    native.nativeWidgets.mockReturnValue(null);
    await expect(refreshWidgetSnapshot('foreground', { force: true })).resolves.toBe('skipped');
    await clearWidgetSnapshot();
    expect(native.__module.setSnapshot).not.toHaveBeenCalled();
  });
});

describe('refresh triggers', () => {
  it('refreshes on foreground and on an entitlement change', async () => {
    withPreferences('full');
    const api = serve(golden, { ...golden, etag: 'b' }, { ...golden, etag: 'c' });
    const listeners: ((state: AppStateStatus) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    const unbind = bindWidgetRefresh(getQueryClient());
    listeners.forEach((listener) => {
      listener('active');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls).toHaveLength(1);
    const pro = bootstrap();
    getQueryClient().setQueryData(
      qk.me.bootstrap(),
      bootstrap({
        notification_preferences: {
          ...pro.notification_preferences,
          detail_level: 'full',
          lock_screen_private: false,
        },
        entitlement: { ...pro.entitlement, is_active: true },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls).toHaveLength(2);
    unbind();
    spy.mockRestore();
  });
});

describe('da-background-refresh task', () => {
  it('is defined at import, registered every 30 min and refreshes the widgets', async () => {
    const tasks = jest.requireMock<{ defineTask: jest.Mock }>('expo-task-manager');
    const background = jest.requireMock<{ registerTaskAsync: jest.Mock }>('expo-background-task');
    expect(tasks.defineTask).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK, expect.any(Function));
    await scheduleBackgroundRefresh();
    expect(background.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK, {
      minimumInterval: 30,
    });
    withPreferences('full');
    serve(golden);
    await expect(runBackgroundRefresh()).resolves.toBe(true);
    expect(events('widget_snapshot_refreshed').map((e) => e.props)).toEqual([
      { trigger: 'background', result: 'ok' },
    ]);
  });
});

describe('widget deep links (§11.5, M-GL-07)', () => {
  it('maps widget routes to analytics targets', () => {
    expect(widgetTarget('/briefing/:id/listen')).toBe('briefing');
    expect(widgetTarget('/meeting/:eventId/prep')).toBe('meeting');
    expect(widgetTarget('/event/:id')).toBe('meeting');
    expect(widgetTarget('/followups')).toBe('flow');
    expect(widgetTarget('/mail/:id')).toBe('flow');
    expect(widgetTarget('/approvals/:id')).toBe('approvals');
    expect(widgetTarget('/settings/accounts')).toBe('today');
    expect(widgetOpenFromHref('/today?src=push', '/today')).toBeNull();
    expect(widgetOpenFromHref('/today?src=widget&w=watch', '/today')).toBeNull();
  });

  it('emits widget_opened and deep_link_opened{source:"widget"} for a widget tap', () => {
    // Signed out here: the link is kept for replay after sign-in and still counted.
    redirectSystemPath({
      path: 'dijitalasistan-dev://briefing/00000000-0000-4000-8000-000000000b01/listen?autoplay=1&src=widget&w=large',
      initial: false,
    });
    expect(events('widget_opened').map((e) => e.props)).toEqual([
      { family: 'large', target: 'briefing' },
    ]);
    expect(events('deep_link_opened').at(-1)?.props).toEqual({
      route_pattern: '/briefing/:id/listen',
      source: 'widget',
      guarded: true,
    });
  });
});

describe('da-widgets config plugin', () => {
  type Mod = { modResults: Record<string, unknown> } & Record<string, unknown>;
  function run(appGroup: string) {
    const plist: Record<string, unknown> = {};
    const manifest = {
      manifest: {
        $: {},
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            receiver: [
              { $: { 'android:name': 'expo.modules.dawidgets.DaNextWidgetReceiver' } },
              { $: { 'android:name': 'other.Receiver' } },
            ],
          },
        ],
      },
    };
    const mods = {
      AndroidConfig: ConfigPlugins.AndroidConfig,
      withInfoPlist: (config: object, action: (mod: Mod) => Mod) =>
        action({ ...config, modResults: plist }),
      withAndroidManifest: (config: object, action: (mod: Mod) => Mod) =>
        action({ ...config, modResults: manifest }),
    } as unknown as DaWidgetsMods;
    createWithDaWidgets(mods)({ name: 'x', slug: 'x' }, { appGroup });
    return { plist, receivers: manifest.manifest.application[0]?.receiver ?? [] };
  }

  it('publishes the App Group and declares both Glance receivers once', () => {
    const { plist, receivers } = run('group.com.dijitalasistan.app.dev');
    expect(plist.DAAppGroup).toBe('group.com.dijitalasistan.app.dev');
    const names = receivers.map((r) => r.$['android:name']);
    expect(names).toEqual(['other.Receiver', ...WIDGET_RECEIVERS.map((r) => r.name)]);
    expect(JSON.stringify(receivers)).toContain('android.appwidget.provider');
    expect(JSON.stringify(receivers)).toContain('"android:exported":"false"');
  });

  it('refuses an invalid App Group', () => {
    expect(() => run('not a group')).toThrow(/App Group/);
  });
});

describe('generated native sources', () => {
  it('match @da/i18n and @da/design-tokens (run widgets:generate on drift)', () => {
    for (const [path, content] of generateWidgetNative(APP_ROOT)) {
      expect({ path, content: readFileSync(join(APP_ROOT, path), 'utf8') }).toEqual({
        path,
        content,
      });
    }
    expect(Object.keys(WIDGET_NATIVE_FILES)).toHaveLength(6);
  });

  it('flattens ICU plurals and tabulates the Turkish locative', () => {
    expect(flattenMessage('{count, plural, one {# item} other {# items}} ready')).toEqual({
      one: '{count} item ready',
      other: '{count} items ready',
      plural: 'count',
    });
    expect(flattenMessage('Sonraki · {time}')).toEqual({
      one: 'Sonraki · {time}',
      other: 'Sonraki · {time}',
      plural: null,
    });
    expect(() => flattenMessage('{kind, select, a {A} other {B}}')).toThrow();
    const { byHour, byMinute } = trLocativeTables();
    expect(byMinute[30]).toBe('da');
    expect(byMinute[40]).toBe('ta');
    expect(byMinute[15]).toBe('te');
    expect(byHour[7]).toBe('de');
    expect(byHour[10]).toBe('da');
  });

  function sources(dir: string, extension: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'generated' && entry !== 'Generated') out.push(...sources(path, extension));
      } else if (entry.endsWith(extension)) {
        out.push(readFileSync(path, 'utf8'));
      }
    }
    return out;
  }

  const catalog = new Set<string>();
  const collect = (value: unknown, prefix: string) => {
    if (typeof value === 'string') catalog.add(prefix);
    else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) collect(v, prefix === '' ? k : `${prefix}.${k}`);
    }
  };
  collect(
    JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/i18n/messages/tr/widgets.json'), 'utf8'),
    ) as unknown,
    '',
  );
  const KEY =
    /"((?:small|medium|large|lock|android|gallery|private|badge|counts|a11y)\.[A-Za-z]+|generic|empty|firstRun|signIn|connect|staleMeta|staleBody|lastAnalysis|today)"/g;

  it.each([
    ['Swift', join(APP_ROOT, 'targets/widget'), '.swift'],
    ['Kotlin', join(APP_ROOT, 'modules/da-widgets/android/src/main/java'), '.kt'],
  ])('%s widgets only use existing widgets.* keys', (_name, dir, extension) => {
    const used = new Set<string>();
    for (const source of sources(dir, extension)) {
      for (const match of source.matchAll(KEY)) used.add(match[1] ?? '');
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((key) => !catalog.has(key))).toEqual([]);
  });

  it.each([
    ['WidgetColors', join(APP_ROOT, 'targets/widget'), '.swift', WIDGET_NATIVE_FILES.swiftColors],
    [
      'DaColors',
      join(APP_ROOT, 'modules/da-widgets/android/src/main/java'),
      '.kt',
      WIDGET_NATIVE_FILES.kotlinColors,
    ],
  ])('%s references resolve to generated tokens', (name, dir, extension, generated) => {
    const tokens = readFileSync(join(APP_ROOT, generated), 'utf8');
    const used = new Set<string>();
    for (const source of sources(dir, extension)) {
      for (const match of source.matchAll(new RegExp(`${name}\\.(\\w+)`, 'g'))) {
        used.add(match[1] ?? '');
      }
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((token) => !new RegExp(`(let|val) ${token} =`).test(tokens))).toEqual(
      [],
    );
  });
});
