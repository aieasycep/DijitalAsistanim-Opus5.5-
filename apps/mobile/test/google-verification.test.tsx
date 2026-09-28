/**
 * KPL-32 on the Gmail explainer (M-ON-06G): while `config.google_oauth_verified` is false the sheet
 * warns that Google's consent screen may say the app is unverified; a verified app (or a bootstrap
 * without the field) shows the plain note.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from 'expo-router/testing-library';

import { resetAppState } from './helpers/app';
import { onboardingBootstrap, openApp } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const NOTICE = /"Google bu uygulamayı doğrulamadı" uyarısı gösterebilir/;

async function openGmailExplainer(verified: boolean | undefined) {
  const base = onboardingBootstrap('connect_mail', { accounts: [] });
  await openApp({
    data: {
      ...base,
      config: {
        ...base.config,
        ...(verified === undefined ? {} : { google_oauth_verified: verified }),
      },
    },
    landing: '/connect-mail',
  });
  await fireEvent.press(await screen.findByTestId('connectMail.row.google'));
  expect(await screen.findByText('Mail erişimine neden ihtiyacımız var?')).toBeOnTheScreen();
}

beforeEach(async () => {
  await resetAppState();
});

describe('Gmail explainer: Google OAuth verification notice', () => {
  it('warns about the unverified-app screen while Google has not verified the app', async () => {
    await openGmailExplainer(false);
    expect(screen.getByText(NOTICE)).toBeOnTheScreen();
  });

  it('shows the plain note once the app is verified', async () => {
    await openGmailExplainer(true);
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(
      screen.getByText("Sonraki adımda Google'ın kendi izin ekranı açılır."),
    ).toBeOnTheScreen();
  });

  it('shows no notice when the server does not report the status', async () => {
    await openGmailExplainer(undefined);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
