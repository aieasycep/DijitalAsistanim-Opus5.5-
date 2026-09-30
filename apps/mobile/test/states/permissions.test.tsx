/**
 * T-8.21 · M-SET-31 İzinler (SCREEN_AND_FLOW_MAP M-SET-31): the account capabilities from
 * `connected_accounts` (or the connect row when none), the OS rows with an in-context explanation
 * before the system prompt, the prompt result (granted, blocked) recorded as `permission_requested`,
 * "Şimdi değil", and the system-settings footer.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { resetAppState } from '../helpers/app';
import { googleAccount } from '../helpers/fixtures';
import { events, openApp } from '../helpers/journeys';

const PATH = '/settings/privacy/permissions';

function account() {
  return {
    id: googleAccount.id,
    provider: 'google',
    account_email: 'ahmet@example.com',
    display_label: null,
    status: 'healthy',
    status_reason: null,
    capabilities_granted: ['mail_read', 'calendar_read'],
    granted_scopes: [],
    data_source_toggles: googleAccount.data_sources,
    last_sync_at: null,
    last_error_code: null,
    updated_at: '2026-09-24T07:40:00Z',
  };
}

beforeEach(async () => {
  await resetAppState();
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({ status: 'undetermined', canAskAgain: true } as never);
});

describe('M-SET-31 · İzinler', () => {
  it('explains before prompting and records a granted notification permission', async () => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true } as never);
    await openApp({ path: PATH });
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, Sorulmadı')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByTestId('permissions.os.notifications'));
    const sheet = await screen.findByTestId('sheet.permissionWhy');
    expect(within(sheet).getByText('Bildirimler izni neden gerekli?')).toBeOnTheScreen();
    await fireEvent.press(within(sheet).getByTestId('permissionWhy.allow'));
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, İzin verildi')).toBeOnTheScreen();
    });
    expect(events('permission_row_tapped').at(-1)?.props).toEqual({
      permission: 'notifications',
      state: 'undetermined',
    });
    expect(events('permission_requested').at(-1)?.props).toEqual({
      permission: 'notifications',
      result: 'granted',
    });
  });

  it('records a refusal that cannot be asked again as blocked', async () => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false } as never);
    await openApp({ path: PATH });
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, Sorulmadı')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByTestId('permissions.os.notifications'));
    await fireEvent.press(await screen.findByTestId('permissionWhy.allow'));
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, Reddedildi')).toBeOnTheScreen();
    });
    expect(events('permission_requested').at(-1)?.props).toEqual({
      permission: 'notifications',
      result: 'blocked',
    });
  });

  it('closes the explanation with "Şimdi değil" and opens the system settings from the footer', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings');
    openSettings.mockClear();
    await openApp({ path: PATH });
    await waitFor(() => {
      expect(screen.getByLabelText('Bildirimler, Sorulmadı')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByTestId('permissions.os.notifications'));
    const sheet = await screen.findByTestId('sheet.permissionWhy');
    await fireEvent.press(within(sheet).getByText('Şimdi değil'));
    await waitFor(() => {
      expect(screen.queryByTestId('permissionWhy.allow')).toBeNull();
    });
    await fireEvent.press(screen.getByTestId('permissions.systemSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('lists the granted capabilities per account and opens the account', async () => {
    const { router } = await openApp({
      path: PATH,
      setup: (db) => {
        db.setTable('connected_accounts', [account()]);
      },
    });
    const row = await screen.findByTestId(`permissions.account.${googleAccount.id}`);
    expect(row).toHaveTextContent(/Mailleri okuma/);
    await fireEvent.press(row);
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/settings/accounts/${googleAccount.id}`);
    });
  });

  it('offers to connect an account when none is connected', async () => {
    const { router } = await openApp({
      path: PATH,
      setup: (db) => {
        db.setTable('connected_accounts', []);
      },
    });
    await fireEvent.press(await screen.findByTestId('permissions.connect'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/accounts');
    });
  });
});
