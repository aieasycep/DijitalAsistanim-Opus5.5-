/**
 * T-8.05 session security (SECURITY_AND_PRIVACY_PLAN CTL-3.13, TST-MB-01…03):
 * LargeSecureStore keeps the AES key in SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) and
 * the session ciphertext in the AES-256 MMKV `da-session`; the first run purges stale keychain
 * keys; logout runs every cleanup step (registered hooks included) even when some fail, and
 * leaves no session in storage.
 */
import { createSupabaseClient, type EmptyDatabase } from '@da/api-client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';

import { largeSecureStore } from '../src/lib/auth/large-secure-store';
import { installationId, prepareSecureStorage } from '../src/lib/auth/first-run-purge';
import { LOGOUT_HOOKS, logout, registerLogoutCleanup } from '../src/lib/auth/logout';
import { bufferedEventsForTests, resetAnalyticsForTests } from '../src/lib/events';
import { createAppQueryClient } from '../src/lib/query/client';
import {
  INSTALL_KEYS,
  MMKV_IDS,
  SECURE_KEYS,
  STORAGE_KEY_LENGTH,
  base64Url,
  encryptedStorage,
  installStorage,
  openEncryptedStorage,
  resetStorageForTests,
} from '../src/lib/storage';
import { session } from './helpers/fixtures';

interface SecureStoreMock {
  __store: Map<string, string>;
  __accessibility: Map<string, unknown>;
}
interface MmkvMock {
  __instances: Map<string, { __encryptionKey: string | null; __encryptionType: string | null }>;
}

const secure = jest.requireMock<SecureStoreMock>('expo-secure-store');
const mmkv = jest.requireMock<MmkvMock>('react-native-mmkv');

function freshDevice(): void {
  resetStorageForTests();
  secure.__store.clear();
  secure.__accessibility.clear();
  mmkv.__instances.clear();
  resetAnalyticsForTests();
}

describe('storage keys', () => {
  it('encodes base64url without padding', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64Url(new Uint8Array(24)).length).toBe(STORAGE_KEY_LENGTH);
  });
});

describe('LargeSecureStore', () => {
  beforeEach(freshDevice);

  it('keeps the AES key in SecureStore and the session ciphertext in AES-256 MMKV', async () => {
    await largeSecureStore.setItem('da.auth.session', JSON.stringify(session()));
    const key = secure.__store.get(SECURE_KEYS.session);
    expect(key).toHaveLength(STORAGE_KEY_LENGTH);
    expect(secure.__accessibility.get(SECURE_KEYS.session)).toBe(
      SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    );
    const store = mmkv.__instances.get(MMKV_IDS.session);
    expect(store?.__encryptionKey).toBe(key);
    expect(store?.__encryptionType).toBe('AES-256');
    // The session itself never goes to SecureStore.
    expect([...secure.__store.values()].some((v) => v.includes('refresh-token'))).toBe(false);
    expect(await largeSecureStore.getItem('da.auth.session')).toContain('refresh-token');
    await largeSecureStore.removeItem('da.auth.session');
    expect(await largeSecureStore.getItem('da.auth.session')).toBeNull();
  });

  it('reuses the stored key on the next launch', async () => {
    await openEncryptedStorage();
    const first = secure.__store.get(SECURE_KEYS.session);
    resetStorageForTests();
    await openEncryptedStorage();
    expect(secure.__store.get(SECURE_KEYS.session)).toBe(first);
    expect(mmkv.__instances.get(MMKV_IDS.cache)?.__encryptionType).toBe('AES-256');
    expect(mmkv.__instances.get(MMKV_IDS.prefs)?.__encryptionKey).toBe(
      secure.__store.get(SECURE_KEYS.mmkv),
    );
  });

  it('backs a real Supabase client: the persisted session is read back from MMKV', async () => {
    const supabase = createSupabaseClient<EmptyDatabase>({
      url: 'https://project-ref.supabase.test',
      publishableKey: 'sb_publishable_jest0000',
      storage: largeSecureStore,
      autoRefreshToken: false,
      fetch: () => Promise.reject(new Error('offline')),
    });
    await largeSecureStore.setItem('da.auth.session', JSON.stringify(session()));
    const { data } = await supabase.auth.getSession();
    expect(data.session?.refresh_token).toBe('refresh-token');
    await supabase.auth.signOut({ scope: 'local' });
    expect(encryptedStorage().session.getString('da.auth.session')).toBeUndefined();
  });
});

describe('first-run keychain purge', () => {
  beforeEach(freshDevice);

  it('deletes stale SecureStore keys before opening storage, signs out locally, then flags', async () => {
    secure.__store.set(SECURE_KEYS.session, 'k'.repeat(32));
    secure.__store.set(SECURE_KEYS.oauthPending, '{"device_nonce":"x"}');
    const order: string[] = [];
    const signOutLocal = jest.fn(() => {
      order.push('sign_out');
      return Promise.reject(new Error('no session'));
    });
    const result = await prepareSecureStorage({
      signOutLocal,
      openStorage: async () => {
        order.push('open');
        return openEncryptedStorage();
      },
      newInstallationId: () => '00000000-0000-4000-8000-000000000777',
    });
    expect(result).toEqual({
      firstRun: true,
      installationId: '00000000-0000-4000-8000-000000000777',
    });
    expect(order).toEqual(['open', 'sign_out']);
    expect(secure.__store.get(SECURE_KEYS.session)).not.toBe('k'.repeat(32));
    expect(secure.__store.has(SECURE_KEYS.oauthPending)).toBe(false);
    expect(installStorage().getBoolean(INSTALL_KEYS.firstRunDone)).toBe(true);
    expect(installationId()).toBe('00000000-0000-4000-8000-000000000777');
  });

  it('does not purge on later launches', async () => {
    await prepareSecureStorage({ signOutLocal: () => Promise.resolve() });
    const key = secure.__store.get(SECURE_KEYS.session);
    const signOutLocal = jest.fn(() => Promise.resolve());
    // A relaunch: the install store's file survives, the in-memory instances do not.
    const install = installStorage();
    resetStorageForTests();
    const again = await prepareSecureStorage({ signOutLocal, install: () => install });
    expect(again.firstRun).toBe(false);
    expect(signOutLocal).not.toHaveBeenCalled();
    expect(secure.__store.get(SECURE_KEYS.session)).toBe(key);
  });
});

describe('logout', () => {
  beforeEach(async () => {
    freshDevice();
    await prepareSecureStorage({ signOutLocal: () => Promise.resolve() });
  });

  function deps(overrides: Record<string, unknown> = {}) {
    const supabase = createSupabaseClient<EmptyDatabase>({
      url: 'https://project-ref.supabase.test',
      publishableKey: 'sb_publishable_jest0000',
      storage: largeSecureStore,
      autoRefreshToken: false,
      // Offline: the revoke call fails, the local session must still be gone.
      fetch: () => Promise.reject(new TypeError('Network request failed')),
    });
    const api = { call: jest.fn(() => Promise.reject(new Error('offline'))), stream: jest.fn() };
    return {
      supabase,
      api,
      queryClient: createAppQueryClient({ gcTime: Infinity }),
      isOffline: () => true,
      ...overrides,
    } as const;
  }

  it('leaves no session, no cache and new keys, even offline', async () => {
    await largeSecureStore.setItem('da.auth.session', JSON.stringify(session()));
    encryptedStorage().cache.set('da.query-cache', '{"clientState":{}}');
    const keysBefore = new Map(secure.__store);
    const d = deps();
    d.queryClient.setQueryData(['me', 'bootstrap'], { cached: true });

    const report = await logout({ scope: 'local' }, d as never);

    expect(await largeSecureStore.getItem('da.auth.session')).toBeNull();
    expect(encryptedStorage().session.getAllKeys()).toEqual([]);
    expect(encryptedStorage().cache.getAllKeys()).toEqual([]);
    expect(d.queryClient.getQueryData(['me', 'bootstrap'])).toBeUndefined();
    expect(secure.__store.get(SECURE_KEYS.session)).not.toBe(keysBefore.get(SECURE_KEYS.session));
    expect(secure.__store.get(SECURE_KEYS.mmkv)).not.toBe(keysBefore.get(SECURE_KEYS.mmkv));
    expect(mmkv.__instances.get(MMKV_IDS.session)?.__encryptionKey).toBe(
      secure.__store.get(SECURE_KEYS.session),
    );
    expect(report.failedSteps).toContain('devices_unregister');
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(bufferedEventsForTests().at(-1)).toMatchObject({
      event: 'sign_out',
      props: { context: 'settings', scope: 'this', offline: true },
    });
  });

  it('unregisters the device with the installation id before signing out', async () => {
    const order: string[] = [];
    const api = {
      call: jest.fn((key: string, input: { body: unknown }) => {
        order.push(key);
        expect(input.body).toEqual({ installation_id: installationId(), reason: 'logout' });
        return Promise.resolve({ data: { disabled_tokens: 1 } });
      }),
      stream: jest.fn(),
    };
    const supabase = {
      auth: {
        signOut: jest.fn((options: { scope: string }) => {
          order.push(`sign_out:${options.scope}`);
          return Promise.resolve({ error: null });
        }),
      },
    };
    await logout({ scope: 'global' }, deps({ api, supabase }) as never);
    expect(order).toEqual(['POST /devices/unregister', 'sign_out:global']);
  });

  it('runs the registered cleanup hooks in their phases, and a failing hook stops nothing', async () => {
    const order: string[] = [];
    const supabase = {
      auth: {
        signOut: jest.fn(() => {
          order.push('sign_out');
          return Promise.resolve({ error: null });
        }),
      },
    };
    const off = [
      registerLogoutCleanup(
        LOGOUT_HOOKS.revenueCat,
        () => {
          order.push('revenuecat');
        },
        'before_sign_out',
      ),
      registerLogoutCleanup(LOGOUT_HOOKS.widgetSnapshot, () => {
        order.push('widgets');
        throw new Error('App Group unavailable');
      }),
      registerLogoutCleanup(LOGOUT_HOOKS.niBuffer, () => {
        order.push('ni');
      }),
    ];
    const report = await logout({}, deps({ supabase }) as never);
    off.forEach((unregister) => {
      unregister();
    });
    expect(order).toEqual(['revenuecat', 'sign_out', 'widgets', 'ni']);
    expect(report.failedSteps).toEqual(
      expect.arrayContaining(['devices_unregister', LOGOUT_HOOKS.widgetSnapshot]),
    );
    expect(report.failedSteps).not.toContain(LOGOUT_HOOKS.niBuffer);
    expect(report.failedSteps).not.toContain('storage');
  });
});
