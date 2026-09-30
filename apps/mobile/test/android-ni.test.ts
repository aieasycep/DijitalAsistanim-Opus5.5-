/**
 * T-8.26 Android Notification Intelligence, non-UI parts: the upload payload carries no text
 * field (acceptance), batch + idempotency, the Pro gate and 402, stale signals, the
 * `POST /devices/register {android_ni}` mirror, the logout wipe, the bundled denylist parity with
 * the Kotlin `PackageRules`, and the config plugin that merges the listener into the manifest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANDROID_CHANNELS, androidChannelFor } from '@da/domain/notifications/channels';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import type { AndroidConfig } from 'expo/config-plugins';
import * as ConfigPlugins from 'expo/config-plugins';

import {
  applyNotificationIntelligence,
  createWithNotificationIntelligence,
  NI_BIND_PERMISSION,
  NI_SERVICE,
} from '../modules/notification-intelligence/plugin/withNotificationIntelligence';
import {
  applyChoice,
  androidNiRegistration,
  DEFAULT_CHOICE,
} from '../src/features/android-ni/choice';
import { reconcileEntitlement } from '../src/features/android-ni/lifecycle';
import {
  allowedPackagesFor,
  DEFAULT_CATEGORIES,
  LOCKED_PACKAGES,
} from '../src/features/android-ni/presets';
import {
  batchIdempotencyKey,
  flushAniSignals,
  toUploadSignal,
  UPLOAD_FIELDS,
} from '../src/features/android-ni/upload';
import { ensureAndroidChannels } from '../src/features/onboarding/push';
import { LOGOUT_HOOKS, logout } from '../src/lib/auth/logout';
import { deviceRegisterBody } from '../src/lib/device';
import { patchBootstrapCache } from '../src/lib/postgrest';
import { getQueryClient } from '../src/lib/query/client';
import { qk } from '@da/api-client';
import { installApi, json, resetAppState } from './helpers/app';
import { bootstrap, errorBody, ok } from './helpers/fixtures';
import { asAndroid, installFakeNi, niSignal, restorePlatform } from './helpers/ni';
import { PRO_ENTITLEMENT } from './helpers/journeys';

const NOW = new Date('2027-01-10T09:00:00Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function seedBootstrap(pro: boolean, flags: Record<string, boolean> = {}): void {
  const data = bootstrap();
  getQueryClient().setQueryData(qk.me.bootstrap(), {
    ...data,
    flags: { ...data.flags, ...flags },
    entitlement: pro ? PRO_ENTITLEMENT : data.entitlement,
  });
}

beforeEach(async () => {
  await resetAppState();
  asAndroid();
});

afterEach(() => {
  restorePlatform();
});

describe('upload payload (T-8.26 acceptance: no text fields)', () => {
  it('rebuilds a signal from the allow-listed fields only', () => {
    const raw = {
      ...niSignal(1, { amount: { value: '149.90', currency: 'TRY' }, due_date: '2027-01-15' }),
      title: 'Kargonuz teslim edildi',
      text: 'Ayşe Yılmaz, 1234567890123 numaralı gönderi',
      uploaded: false,
    };
    const signal = toUploadSignal(raw);
    expect(signal).not.toBeNull();
    expect(Object.keys(signal ?? {}).sort()).toEqual(
      expect.arrayContaining(['signal_hash', 'package', 'app_label', 'category', 'posted_at']),
    );
    for (const key of Object.keys(signal ?? {})) {
      expect(UPLOAD_FIELDS as readonly string[]).toContain(key);
    }
    expect(JSON.stringify(signal)).not.toMatch(/Ayşe|teslim edildi|1234567890123/);
    expect(toUploadSignal({ ...niSignal(2), app_label: 'x'.repeat(61) })).toBeNull();
    expect(toUploadSignal({ ...niSignal(3), category: 'chat' })).toBeNull();
    expect(toUploadSignal(null)).toBeNull();
  });

  it('derives a stable UUID-shaped idempotency key from the batch', () => {
    const a = batchIdempotencyKey([niSignal(1).signal_hash, niSignal(2).signal_hash]);
    const b = batchIdempotencyKey([niSignal(2).signal_hash, niSignal(1).signal_hash]);
    const c = batchIdempotencyKey([niSignal(3).signal_hash]);
    expect(a).toMatch(UUID_V4);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe('flushAniSignals (API-ANI-01)', () => {
  it('uploads the pending batch once, marks it uploaded and never sends text', async () => {
    seedBootstrap(true);
    const ni = installFakeNi({ granted: true, enabled: true });
    ni.buffer.push(
      { signal: { ...niSignal(1), posted_at: '2027-01-10T08:00:00.000Z' }, uploaded: false },
      {
        signal: {
          ...niSignal(2, {
            category: 'bank_payment',
            amount: { value: '1250.50', currency: 'TRY' },
          }),
          posted_at: '2027-01-09T08:00:00.000Z',
          // A field the extractor never produces must not travel either.
          ...({ text: 'Ekstre borcunuz 1.250,50 TL' } as object),
        },
        uploaded: false,
      },
      { signal: { ...niSignal(3), posted_at: '2026-12-01T08:00:00.000Z' }, uploaded: false },
    );
    const api = installApi({
      'POST /android-notifications/signals': () =>
        json(202, ok({ accepted: 2, duplicates: 0, rejected: 0 })),
    });
    const result = await flushAniSignals({ now: () => NOW });
    expect(result).toBe('uploaded');
    const calls = api.calls.filter((c) => c.url.endsWith('/android-notifications/signals'));
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { installation_id: string; signals: Record<string, unknown>[] };
    expect(body.signals.map((s) => s.signal_hash)).toEqual([
      niSignal(1).signal_hash,
      niSignal(2).signal_hash,
    ]);
    for (const signal of body.signals) {
      expect(
        Object.keys(signal).every((k) => (UPLOAD_FIELDS as readonly string[]).includes(k)),
      ).toBe(true);
      expect(signal).not.toHaveProperty('text');
      expect(signal).not.toHaveProperty('title');
    }
    expect(calls[0]?.headers['idempotency-key']).toBe(
      batchIdempotencyKey([niSignal(1).signal_hash, niSignal(2).signal_hash]),
    );
    // The stale (older than 7 days) signal is dropped from the buffer; the others are uploaded.
    expect(ni.module.deleteSignal).toHaveBeenCalledWith(niSignal(3).signal_hash);
    expect(ni.module.markUploaded).toHaveBeenCalledWith([
      niSignal(1).signal_hash,
      niSignal(2).signal_hash,
    ]);
    expect(ni.buffer.every((e) => e.uploaded)).toBe(true);
  });

  it('keeps the batch on 402 and skips Free users, a disabled flag, iOS and offline', async () => {
    seedBootstrap(true);
    const ni = installFakeNi({ granted: true, enabled: true });
    ni.buffer.push({
      signal: { ...niSignal(1), posted_at: '2027-01-10T08:00:00.000Z' },
      uploaded: false,
    });
    const api = installApi({
      'POST /android-notifications/signals': () => json(402, errorBody('ENTITLEMENT_REQUIRED')),
    });
    await expect(flushAniSignals({ now: () => NOW })).resolves.toBe('not_entitled');
    expect(ni.buffer[0]?.uploaded).toBe(false);

    seedBootstrap(false);
    await expect(flushAniSignals({ now: () => NOW })).resolves.toBe('not_entitled');
    seedBootstrap(true, { 'feature.android_ni': false });
    await expect(flushAniSignals({ now: () => NOW })).resolves.toBe('disabled');
    seedBootstrap(true);
    onlineManager.setOnline(false);
    await expect(flushAniSignals({ now: () => NOW })).resolves.toBe('offline');
    onlineManager.setOnline(true);
    restorePlatform();
    await expect(flushAniSignals({ now: () => NOW })).resolves.toBe('unsupported');
    expect(api.calls.filter((c) => c.url.endsWith('/signals'))).toHaveLength(1);
  });
});

describe('devices/register android_ni mirror (API-DEV-01)', () => {
  it('reports the grant, the switch, the mode and the preset packages', async () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    applyChoice(DEFAULT_CHOICE);
    const body = await deviceRegisterBody('00000000-0000-4000-8000-000000000099');
    expect(body.android_ni).toEqual({
      available: true,
      listener_granted: true,
      enabled: true,
      mode: 'selected',
      allowed_packages: [...allowedPackagesFor(DEFAULT_CATEGORIES, [])],
    });
    applyChoice({ ...DEFAULT_CHOICE, mode: 'all' });
    expect(ni.state.mode).toBe('all');
    expect(androidNiRegistration()).toMatchObject({ mode: 'all', allowed_packages: [] });
  });

  it('reports unavailable without the module and nothing on iOS', async () => {
    const ni = installFakeNi();
    ni.module.isAvailable.mockReturnValue(false);
    expect(androidNiRegistration()).toEqual({
      available: false,
      listener_granted: false,
      enabled: false,
      mode: 'selected',
      allowed_packages: [],
    });
    restorePlatform();
    const body = await deviceRegisterBody('00000000-0000-4000-8000-000000000099');
    expect(body).not.toHaveProperty('android_ni');
  });

  it('pauses the analysis when Pro ends and resumes it when Pro returns', () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    seedBootstrap(false);
    expect(reconcileEntitlement()).toBe(true);
    expect(ni.state.enabled).toBe(false);
    patchBootstrapCache((data) => ({ ...data, entitlement: PRO_ENTITLEMENT }));
    expect(reconcileEntitlement()).toBe(true);
    expect(ni.state.enabled).toBe(true);
    expect(reconcileEntitlement()).toBe(false);
  });
});

describe('phone_digest channel (R-12)', () => {
  it('creates the low-importance NI digest channel with the other R-12 channels', async () => {
    const Notifications = jest.requireMock<{ setNotificationChannelAsync: jest.Mock }>(
      'expo-notifications',
    );
    Notifications.setNotificationChannelAsync.mockClear();
    await ensureAndroidChannels();
    const digest = Notifications.setNotificationChannelAsync.mock.calls.find(
      ([id]) => id === 'phone_digest',
    );
    // The device locale is English in this suite (no expo-localization mock).
    expect(digest?.[1]).toMatchObject({ name: 'Phone notification digest', importance: 2 });
    expect(androidChannelFor('life_intel', { fromAndroidNotificationSignal: true })).toBe(
      'phone_digest',
    );
    expect(ANDROID_CHANNELS.find((c) => c.id === 'phone_digest')?.importance).toBe('low');
  });
});

describe('logout hook (LOGOUT_HOOKS.niBuffer)', () => {
  it('wipes the buffer and the listener settings at sign-out', async () => {
    const ni = installFakeNi({ granted: true, enabled: true });
    ni.buffer.push({ signal: niSignal(1), uploaded: false });
    const report = await logout(
      {},
      {
        installationId: () => null,
        supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } } as never,
        wipeStorage: () => Promise.resolve(),
        unregisterPush: () => Promise.resolve(),
        cancelLocalNotifications: () => Promise.resolve(),
        isOffline: () => true,
      },
    );
    expect(report.failedSteps).not.toContain(LOGOUT_HOOKS.niBuffer);
    expect(ni.module.reset).toHaveBeenCalled();
    expect(ni.buffer).toHaveLength(0);
  });
});

describe('locked denylist parity', () => {
  it('bundles exactly the Kotlin PackageRules.LOCKED map', () => {
    const kotlin = readFileSync(
      join(
        __dirname,
        '..',
        'modules/notification-intelligence/android/src/main/java/expo/modules/notificationintelligence/PackageRules.kt',
      ),
      'utf8',
    );
    const GROUP: Record<string, string> = {
      AUTHENTICATOR: 'authenticator',
      PASSWORD_MANAGER: 'password_manager',
      E_DEVLET: 'e_devlet',
      MESSAGING: 'messaging',
      GOOGLE_PLAY_SERVICES: 'google_play_services',
    };
    const entries = [...kotlin.matchAll(/"([a-zA-Z0-9_.]+)" to LockedGroup\.([A-Z_]+)/g)].map(
      ([, pkg, group]) => [pkg, GROUP[group ?? '']] as const,
    );
    expect(Object.fromEntries(entries)).toEqual(LOCKED_PACKAGES);
    // Spec §9 "Locked exclusions" (authenticators, password managers, Play services, e-Devlet, messaging).
    for (const pkg of [
      'com.google.android.apps.authenticator2',
      'com.x8bit.bitwarden',
      'com.google.android.gms',
      'tr.gov.turkiye.edevlet.kapisi',
      'com.whatsapp',
      'org.telegram.messenger',
      'com.turkcell.bip',
    ]) {
      expect(LOCKED_PACKAGES).toHaveProperty([pkg]);
    }
    expect(allowedPackagesFor(DEFAULT_CATEGORIES, ['com.whatsapp', 'com.getir'])).not.toContain(
      'com.whatsapp',
    );
  });
});

describe('notification-intelligence config plugin', () => {
  const baseManifest = () =>
    ({
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        application: [{ $: { 'android:name': '.MainApplication' }, activity: [] }],
      },
    }) as unknown as AndroidConfig.Manifest.AndroidManifest;

  it('declares the listener service behind BIND_NOTIFICATION_LISTENER_SERVICE, once', () => {
    const manifest = applyNotificationIntelligence(applyNotificationIntelligence(baseManifest()));
    const services = manifest.manifest.application?.[0]?.service ?? [];
    expect(services).toHaveLength(1);
    expect(services[0]?.$).toMatchObject({
      'android:name': NI_SERVICE,
      'android:permission': NI_BIND_PERMISSION,
      'android:exported': 'true',
    });
    expect(JSON.stringify(services[0])).toContain(
      'android.service.notification.NotificationListenerService',
    );
    expect(JSON.stringify(services[0])).toContain('conversations|alerting');
    expect(manifest.manifest.queries).toHaveLength(1);
    expect(JSON.stringify(manifest.manifest.queries)).toContain('android.intent.category.LAUNCHER');
    expect(JSON.stringify(manifest)).not.toContain('QUERY_ALL_PACKAGES');
  });

  it('registers an Android manifest mod', () => {
    const withNi = createWithNotificationIntelligence(ConfigPlugins);
    const configured = withNi({ name: 'x', slug: 'x' });
    const mods = (configured as { mods?: Record<string, Record<string, unknown>> }).mods;
    expect(mods?.android?.manifest).toBeDefined();
  });
});
