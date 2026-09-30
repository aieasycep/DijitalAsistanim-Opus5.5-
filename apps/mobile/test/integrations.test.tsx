/**
 * T-8.07 integrations: the client-bound OAuth completion (R-07: one completion per code whoever
 * receives the redirect, none without this device's pending entry), the connected-accounts screen
 * (M-SET-10 status table, platform rows, Free "PRO"), the account detail (data-source PATCH with
 * `expected_updated_at`, revert on failure, sync, disconnect with consequences) and the
 * device-calendar snapshot (only selected calendars, field whitelist, hashed identifiers).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Calendar from 'expo-calendar/legacy';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { completeOAuth, handleOAuthCallback } from '../src/features/integrations/connect';
import { buildSnapshot, defaultSelection } from '../src/features/integrations/device-calendar';
import { newDeviceNonce, savePendingOAuth } from '../src/features/integrations/pending';
import { installApi, json, resetAppState } from './helpers/app';
import { googleAccount, ok, uuid } from './helpers/fixtures';
import { ID, events, openApp } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const CODE = 'D'.repeat(43);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.account,
    provider: 'google',
    account_email: 'ahmet@example.com',
    display_label: null,
    status: 'healthy',
    status_reason: null,
    capabilities_granted: ['mail_read', 'calendar_read'],
    granted_scopes: [],
    data_source_toggles: googleAccount.data_sources,
    last_sync_at: '2026-09-24T07:40:00Z',
    last_error_code: null,
    updated_at: '2026-09-24T07:40:00Z',
    created_at: '2026-09-24T07:00:00Z',
    ...overrides,
  };
}

const completed = () =>
  json(
    200,
    ok({
      result: 'success',
      account: googleAccount,
      granted: ['mail_read'],
      missing: [],
      resume: null,
      jobs: [],
    }),
  );

beforeEach(async () => {
  await resetAppState();
});

describe('OAuth completion (R-07, M-SET-14)', () => {
  it('sends one completion for a double delivery and removes the pending entry', async () => {
    const { client, calls } = installApi({ 'POST /integrations/oauth/complete': completed });
    const { nonce } = await newDeviceNonce();
    await savePendingOAuth({
      device_nonce: nonce,
      provider: 'google',
      capabilities: ['mail_read'],
      return_to: 'settings_accounts',
      started_at: new Date().toISOString(),
    });
    const [a, b] = await Promise.all([completeOAuth(CODE, client), completeOAuth(CODE, client)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ kind: 'completed', result: 'success' });
    expect(calls.filter((c) => c.url.endsWith('/integrations/oauth/complete'))).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ completion_code: CODE, device_nonce: nonce });
    expect(await SecureStore.getItemAsync('da.oauth.pending')).toBeNull();
  });

  it('never calls /complete without a pending entry on this device', async () => {
    const { client, calls } = installApi({ 'POST /integrations/oauth/complete': completed });
    const outcome = await handleOAuthCallback(
      {
        provider: 'google',
        result: 'pending_confirmation',
        completionCode: 'E'.repeat(43),
        errorCode: null,
        adminConsentUrl: null,
      },
      client,
    );
    expect(outcome).toEqual({ kind: 'no_pending' });
    expect(calls).toHaveLength(0);
  });

  it('treats a denial as final and clears the pending entry', async () => {
    const { client } = installApi({});
    const { nonce } = await newDeviceNonce();
    await savePendingOAuth({
      device_nonce: nonce,
      provider: 'microsoft',
      capabilities: ['mail_read'],
      return_to: 'onboarding',
      started_at: new Date().toISOString(),
    });
    const outcome = await handleOAuthCallback(
      {
        provider: 'microsoft',
        result: 'denied',
        completionCode: null,
        errorCode: null,
        adminConsentUrl: null,
      },
      client,
    );
    expect(outcome).toEqual({ kind: 'denied' });
    expect(await SecureStore.getItemAsync('da.oauth.pending')).toBeNull();
  });
});

describe('connected accounts (M-SET-10)', () => {
  it('lists accounts by group with their status and offers the providers to connect', async () => {
    await openApp({
      path: '/settings/accounts',
      setup: (db) => {
        db.setTable('connected_accounts', [
          row(),
          row({
            id: uuid(12),
            provider: 'microsoft',
            status: 'needs_reauth',
            account_email: 'a@corp.example',
            capabilities_granted: ['mail_read'],
          }),
        ]);
      },
    });
    expect(await screen.findByText('Bağlantılar')).toBeOnTheScreen();
    expect(await screen.findByTestId(`accounts.row.mail.${ID.account}`)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/^Gmail · ahmet@example.com, Bağlı, Son eşitleme/),
    ).toBeOnTheScreen();
    expect(screen.getAllByText('Yeniden Bağlan').length).toBeGreaterThan(0);
    // iOS: Apple Takvim is offered, the Android device calendar is not.
    expect(screen.getByTestId('accounts.connect.appleCalendar')).toBeOnTheScreen();
    expect(screen.queryByTestId('accounts.connect.deviceCalendar')).toBeNull();
    expect(events('accounts_opened')).toHaveLength(1);
  });

  it('shows the connect empty state without accounts', async () => {
    await openApp({ path: '/settings/accounts' });
    expect(await screen.findByTestId('accounts.empty')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Hesap Bağla' }));
    expect(await screen.findByTestId('sheet.addAccount')).toBeOnTheScreen();
  });
});

describe('account detail (M-SET-12, M-SET-13)', () => {
  it('patches a data-source toggle with expected_updated_at', async () => {
    const { api } = await openApp({
      path: `/settings/accounts/${ID.account}`,
      setup: (db) => {
        db.setTable('connected_accounts', [row()]);
      },
      routes: {
        [`PATCH /integrations/${ID.account}/data-sources`]: () =>
          json(
            200,
            ok({ account: googleAccount, calendars: [], consequences: ['drafts_disabled'] }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId(`dataSources.${ID.account}.draft_replies`));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      data_sources: { draft_replies: false },
      expected_updated_at: '2026-09-24T07:40:00Z',
    });
    expect(events('data_source_toggled').at(-1)?.props).toEqual({
      toggle: 'draft_replies',
      value: false,
      key: 'draft_replies',
      enabled: false,
    });
  });

  it('asks before turning mail analysis off and reverts a failed save', async () => {
    const { api } = await openApp({
      path: `/settings/accounts/${ID.account}`,
      setup: (db) => {
        db.setTable('connected_accounts', [row()]);
      },
      routes: {
        [`PATCH /integrations/${ID.account}/data-sources`]: () =>
          json(500, { error: { code: 'INTERNAL', message: 'x', retryable: false } }),
      },
    });
    const toggle = await screen.findByTestId(`dataSources.${ID.account}.mail_read`);
    await fireEvent.press(toggle);
    expect(await screen.findByText('Mail analizi kapatılsın mı?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(await screen.findByText('Kaydedilemedi. Tekrar dene.')).toBeOnTheScreen();
  });

  it('disconnects with the purge choice and shows the result', async () => {
    const { api } = await openApp({
      path: `/settings/accounts/${ID.account}`,
      setup: (db) => {
        db.setTable('connected_accounts', [row()]);
      },
      routes: {
        [`POST /integrations/${ID.account}/disconnect`]: () =>
          json(
            200,
            ok({
              account: { ...googleAccount, status: 'disconnected' },
              revocation: 'provider_revoked',
              manual_revoke_url: null,
              purge_job: { job_id: uuid(77), status: 'queued', poll_after_ms: 5000 },
            }),
          ),
      },
    });
    await fireEvent.press(await screen.findByTestId('account.disconnect'));
    expect(await screen.findByText('Gmail bağlantısı kaldırılsın mı?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('disconnect.purge'));
    await fireEvent.press(screen.getByTestId('disconnect.confirm'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/disconnect'))).toBe(true);
    });
    expect(api.calls.find((c) => c.url.endsWith('/disconnect'))?.body).toEqual({
      confirm: true,
      purge_content: false,
    });
    expect(events('account_disconnected').at(-1)?.props).toMatchObject({
      provider: 'google',
      purge_content: false,
      revocation: 'revoked',
    });
  });

  it('shows "Bu bağlantı artık yok." for a removed account', async () => {
    await openApp({ path: `/settings/accounts/${uuid(404)}` });
    expect(await screen.findByText('Bu bağlantı artık yok.')).toBeOnTheScreen();
  });
});

describe('device calendar snapshot (API-INT-06)', () => {
  it('uploads only the selected calendars with the field whitelist', async () => {
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValueOnce([
      {
        id: 'cal-1',
        title: 'Kişisel',
        source: { name: 'iCloud' },
        color: '#5B5CE2',
        allowsModifications: true,
        isPrimary: true,
        type: 'local',
      },
      {
        id: 'cal-2',
        title: 'Tatiller',
        source: { name: 'Abonelik' },
        color: '',
        allowsModifications: false,
        type: 'subscribed',
      },
    ] as never);
    jest.mocked(Calendar.getEventsAsync).mockResolvedValueOnce([
      {
        id: 'evt-1',
        calendarId: 'cal-1',
        title: 'Diş hekimi',
        startDate: '2026-09-25T09:00:00.000Z',
        endDate: '2026-09-25T10:00:00.000Z',
        allDay: false,
        location: 'Kadıköy',
        notes: 'özel not',
        url: 'https://meet.example.com/x',
        status: 'confirmed',
      },
    ] as never);
    const at = new Date('2026-09-24T08:00:00Z');
    const body = await buildSnapshot(['cal-1'], uuid(99), at);
    expect(Calendar.getEventsAsync).toHaveBeenCalledWith(
      ['cal-1'],
      expect.any(Date),
      expect.any(Date),
    );
    expect(body.calendars.map((c) => c.selected)).toEqual([true, false]);
    expect(body.events).toHaveLength(1);
    const event = body.events[0] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(
      [
        'all_day',
        'attendee_count',
        'device_calendar_hash',
        'end_at',
        'event_key_hash',
        'last_modified_at',
        'location',
        'meeting_url',
        'organizer_is_self',
        'start_at',
        'status',
        'title',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('özel not');
    expect(JSON.stringify(body)).not.toContain('cal-1');
    expect(body.window).toEqual({
      start: '2026-09-23T08:00:00.000Z',
      end: '2026-10-08T08:00:00.000Z',
    });
  });

  it('defaults Free to the primary calendar and Pro to every own calendar', () => {
    const calendars = [
      {
        id: 'a',
        title: 'İş',
        sourceTitle: 'x',
        color: null,
        allowsModifications: true,
        isPrimary: false,
        subscribed: false,
      },
      {
        id: 'b',
        title: 'Kişisel',
        sourceTitle: 'x',
        color: null,
        allowsModifications: true,
        isPrimary: true,
        subscribed: false,
      },
      {
        id: 'c',
        title: 'Doğum günleri',
        sourceTitle: 'x',
        color: null,
        allowsModifications: false,
        isPrimary: false,
        subscribed: true,
      },
    ];
    expect(defaultSelection(calendars, false)).toEqual(['b']);
    expect(defaultSelection(calendars, true)).toEqual(['a', 'b']);
  });
});
