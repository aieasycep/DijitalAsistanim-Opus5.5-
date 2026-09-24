/**
 * T-8.20 Privacy Center: truthful copy (R-15, never "uçtan uca"), OS permission states, the
 * data-class consequence sheet, retention shortening with RPC-19 counts (blocked offline), delete
 * history with re-auth on `401 REAUTH_REQUIRED` (R-16) and an honest status, export request →
 * download through a fresh signed URL → share sheet, and account deletion that never shows
 * "silindi" before the server reports it.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { confirmMatches } from '../src/features/privacy/DeleteAccountScreen';
import { isShortening } from '../src/features/privacy/RetentionScreen';
import { resetPendingSettingsForTests } from '../src/features/settings/save';
import { json, resetAppState } from './helpers/app';
import { bootstrap, errorBody, googleAccount, ok, uuid } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
  downloadAsync: jest.fn((_url: string, target: string) =>
    Promise.resolve({ uri: target, status: 200 }),
  ),
  createDownloadResumable: jest.fn((_url: string, target: string) => ({
    downloadAsync: () => Promise.resolve({ uri: target, status: 200 }),
  })),
}));

beforeEach(async () => {
  await resetAppState();
  resetPendingSettingsForTests();
});

const PREVIEW = {
  older_than: null,
  summaries: 12,
  priority_decisions: 40,
  memory_entries: 88,
  learned_preferences: 3,
  assistant_conversations: 2,
  captures: 1,
};

describe('M-SET-30 Privacy Center', () => {
  it('states the promises truthfully and links every area', async () => {
    const { router } = await openApp({
      path: '/settings/privacy',
      setup: (db) => {
        db.setTable('connected_accounts', [
          {
            id: googleAccount.id,
            provider: 'google',
            account_email: 'ahmet@example.com',
            display_label: null,
            status: 'healthy',
            status_reason: null,
            capabilities_granted: ['mail_read', 'mail_send'],
            granted_scopes: [],
            data_source_toggles: googleAccount.data_sources,
            last_sync_at: null,
            last_error_code: null,
            updated_at: '2026-09-24T07:40:00Z',
          },
        ]);
      },
    });
    expect(await screen.findByText('Verilerin reklam amacıyla satılmaz.')).toBeTruthy();
    expect(screen.getByText('Veriler aktarım sırasında ve saklanırken şifrelenir.')).toBeTruthy();
    expect(screen.queryByText(/uçtan uca/i)).toBeNull();
    expect(
      await screen.findByText('Mailleri okuma · Mail gönderme (her seferinde onayınla)'),
    ).toBeTruthy();
    expect(events('privacy_center_opened')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('privacy.row.retention'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/privacy/retention');
    });
  });
});

describe('M-SET-31 permissions', () => {
  it('shows the real OS states and explains before the system prompt', async () => {
    const perms = jest.mocked(Notifications.getPermissionsAsync);
    perms.mockResolvedValue({ status: 'denied', canAskAgain: false } as never);
    await openApp({ path: '/settings/privacy/permissions' });
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, Reddedildi')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('permissions.os.notifications'));
    expect(events('permission_row_tapped').at(-1)?.props).toMatchObject({
      permission: 'notifications',
      state: 'denied',
    });
    perms.mockResolvedValue({ status: 'undetermined', canAskAgain: true } as never);
  });
});

describe('M-SET-32 / M-SET-33 AI accessible data', () => {
  it('asks before turning a class off and saves only on confirm', async () => {
    const { db } = await openApp({ path: '/settings/privacy/data-sources' });
    await fireEvent.press(await screen.findByTestId('dataSources.mail_body'));
    expect(await screen.findByText('Mail gövdeleri kapatılsın mı?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sourceOff.cancel'));
    expect(db.writes).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('dataSources.mail_body'));
    await fireEvent.press(await screen.findByTestId('sourceOff.confirm'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({
        ai_data_access: { ...bootstrap().preferences.ai_data_access, mail_body: false },
      });
    });
    expect(events('ai_access_toggled').at(-1)?.props).toMatchObject({
      class: 'mail_body',
      enabled: false,
      confirmed: true,
    });
  });
});

describe('M-SET-34 / M-SET-35 retention', () => {
  it('lengthens directly and confirms a shortening with the affected count', async () => {
    expect(isShortening('d90', 'd30')).toBe(true);
    expect(isShortening('d90', 'until_deleted')).toBe(false);
    expect(isShortening('until_deleted', 'd365')).toBe(true);
    const { db } = await openApp({
      path: '/settings/privacy/retention',
      setup: (fake) => {
        fake.setRpc('history_deletion_preview', PREVIEW);
      },
    });
    await fireEvent.press(await screen.findByText('1 yıl'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ retention_policy: 'd365' });
    });
    await fireEvent.press(screen.getByText('30 gün'));
    expect(await screen.findByTestId('retentionShorten.body')).toBeTruthy();
    expect(
      screen.getByText(
        '30 günden eski 146 özet, öncelik kararı ve hafıza kaydı bir sonraki temizlikte (en geç 24 saat içinde) kalıcı olarak silinir.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retentionShorten.confirm'));
    await waitFor(() => {
      expect(db.writes.at(-1)?.values).toEqual({ retention_policy: 'd30' });
    });
  });

  it('blocks shortening offline', async () => {
    const { db } = await openApp({ path: '/settings/privacy/retention' });
    await screen.findByText('30 gün');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByText('30 gün'));
    expect(screen.queryByTestId('sheet.retentionShorten')).toBeNull();
    expect(db.writes).toHaveLength(0);
  });
});

describe('M-SET-36 / M-SET-37 / M-SET-40 delete history', () => {
  it('re-authenticates on 401 REAUTH_REQUIRED and resubmits with the same key', async () => {
    let calls = 0;
    const { api, fake } = await openApp({
      path: '/settings/privacy/history',
      data: bootstrap({
        profile: { ...bootstrap().profile, auth_providers: ['email'] },
      }),
      setup: (db) => {
        db.setRpc('history_deletion_preview', PREVIEW);
      },
      routes: {
        'POST /privacy/delete-history': () => {
          calls += 1;
          return calls === 1
            ? json(401, errorBody('REAUTH_REQUIRED'))
            : json(
                202,
                ok({
                  request_id: uuid(401),
                  status: 'queued',
                  will_delete: {
                    summaries: 12,
                    priority_decisions: 40,
                    memory_chunks: 88,
                    assistant_threads: 2,
                    learned_preferences: 3,
                    insights: 40,
                    briefings: 5,
                  },
                  preserved: ['connections', 'settings', 'vip', 'priority_rules'],
                }),
              );
        },
      },
    });
    expect(
      await screen.findByText(
        'Silinecek: 12 özet · 40 öncelik kararı · 88 hafıza kaydı · 3 öğrenilen tercih',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('history.cta'));
    await fireEvent.press(await screen.findByTestId('historyConfirm.delete'));
    expect(await screen.findByTestId('sheet.reauth')).toBeTruthy();
    expect(screen.getByText('Doğrulama süresi doldu, tekrar doğrula.')).toBeTruthy();

    fake.auth.verifyOtp.mockImplementation(() =>
      Promise.resolve({
        data: { user: { id: bootstrap().profile.id, created_at: '2026-09-01T08:00:00Z' } },
        error: null,
      }),
    );
    await fireEvent.press(screen.getByTestId('reauth.sendCode'));
    await fireEvent.changeText(await screen.findByTestId('reauth.code'), '123456');
    await fireEvent.press(screen.getByTestId('reauth.verify'));
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    const posts = api.calls.filter((c) => c.url.endsWith('/privacy/delete-history'));
    expect(posts[1]?.headers['idempotency-key']).toBe(posts[0]?.headers['idempotency-key']);
    expect(posts[1]?.body).toEqual({ scope: { type: 'all_analysis' }, confirm: true });
    expect(events('history_delete_requested')).toHaveLength(1);
    expect(events('reauth_completed').at(-1)?.props).toMatchObject({
      method: 'email_otp',
      result: 'success',
    });
  });

  it('shows processing, never a fake "silindi", while the job runs', async () => {
    await openApp({
      path: '/settings/privacy/history',
      setup: (db) => {
        db.setRpc('history_deletion_preview', PREVIEW);
        db.setTable('data_deletion_requests', [
          {
            id: uuid(402),
            kind: 'history',
            status: 'processing',
            created_at: '2026-09-24T07:00:00Z',
            completed_at: null,
          },
        ]);
      },
    });
    expect(await screen.findByTestId('history.processing')).toBeTruthy();
    expect(screen.queryByTestId('history.completed')).toBeNull();
  });
});

describe('M-SET-38 export', () => {
  it('requests an export', async () => {
    const { api } = await openApp({
      path: '/settings/privacy/export',
      routes: {
        'POST /privacy/export': () => json(202, ok({ request_id: uuid(403), status: 'requested' })),
      },
    });
    await fireEvent.press(await screen.findByTestId('export.cta'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/privacy/export'))).toBe(true);
    });
    expect(events('export_requested')).toHaveLength(1);
  });

  it('downloads a ready export through a fresh signed URL and opens the share sheet', async () => {
    const { api } = await openApp({
      path: '/settings/privacy/export',
      setup: (db) => {
        db.setTable('data_export_requests', [
          {
            id: uuid(404),
            status: 'ready',
            created_at: '2026-09-24T07:00:00Z',
            ready_at: '2026-09-24T07:10:00Z',
            expires_at: '2026-09-25T07:10:00Z',
            file_size_bytes: 2_400_000,
            downloaded_at: null,
          },
        ]);
      },
      routes: {
        [`POST /privacy/export/${uuid(404)}/download`]: () =>
          json(
            200,
            ok({
              signed_url: 'https://storage.example.com/exports/x.zip?token=1',
              expires_at: '2026-09-24T07:15:00Z',
              file_size_bytes: 2_400_000,
              sha256: 'a'.repeat(64),
            }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId('export.download'));
    await waitFor(() => {
      expect(jest.mocked(Sharing.shareAsync)).toHaveBeenCalled();
    });
    expect(api.calls.filter((c) => c.url.endsWith('/download'))).toHaveLength(1);
    expect(events('export_downloaded').at(-1)?.props).toMatchObject({ size_bucket: '1-10mb' });
  });
});

describe('M-SET-39 delete account', () => {
  it('accepts SİL, SIL and sil (tr) and DELETE (en)', () => {
    expect(confirmMatches('SİL', 'tr')).toBe(true);
    expect(confirmMatches('sil', 'tr')).toBe(true);
    expect(confirmMatches('SIL', 'tr')).toBe(true);
    expect(confirmMatches('SILL', 'tr')).toBe(false);
    expect(confirmMatches('delete', 'en')).toBe(true);
    expect(confirmMatches('SİL', 'en')).toBe(false);
  });

  it('requires the subscription acknowledgement, then queues the deletion honestly', async () => {
    const data = bootstrap({
      entitlement: {
        ...bootstrap().entitlement,
        is_active: true,
        source: 'store',
        store: {
          ...bootstrap().entitlement.store,
          active: true,
          store: 'app_store',
          product_id: 'da_pro_annual',
          will_renew: true,
        },
      },
    });
    const { api } = await openApp({
      path: '/settings/privacy/delete-account',
      data,
      routes: {
        'POST /privacy/delete-account': () =>
          json(
            202,
            ok({
              request_id: uuid(405),
              status: 'queued',
              status_token: 'A'.repeat(43),
              subscription_notice: { active: true, management_url: null },
            }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId('deleteAccount.continue'));
    expect(await screen.findByTestId('deleteAccount.ackError')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('deleteAccount.ack'));
    await fireEvent.press(screen.getByTestId('deleteAccount.continue'));
    const word = await screen.findByTestId('deleteAccount.word');
    await fireEvent.changeText(word, 'sil');
    await fireEvent.press(screen.getByTestId('deleteAccount.submit'));
    expect(await screen.findByTestId('deleteAccount.queued')).toBeTruthy();
    expect(screen.queryByTestId('deleteAccount.completed')).toBeNull();
    expect(api.calls.find((c) => c.url.endsWith('/privacy/delete-account'))?.body).toEqual({
      confirm_text: 'SİL',
      acknowledge_subscription: true,
    });
    expect(events('account_delete_requested').at(-1)?.props).toMatchObject({
      had_store_subscription: true,
      login_method: 'apple',
    });
  });

  it('keeps the account when the request fails', async () => {
    await openApp({
      path: '/settings/privacy/delete-account',
      routes: { 'POST /privacy/delete-account': () => json(503, errorBody('SERVICE_UNAVAILABLE')) },
    });
    await fireEvent.press(await screen.findByTestId('deleteAccount.continue'));
    await fireEvent.changeText(await screen.findByTestId('deleteAccount.word'), 'SİL');
    await fireEvent.press(screen.getByTestId('deleteAccount.submit'));
    expect(
      await screen.findByText('Talep gönderilemedi; hesabın silinmedi. Tekrar dene.'),
    ).toBeTruthy();
  });
});
