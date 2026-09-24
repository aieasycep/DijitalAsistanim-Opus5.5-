import { loadMessages } from '@da/i18n';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';

import { REQUIRED_FONT_FAMILIES } from '@da/ui';
import { APP_FONTS } from '../src/lib/fonts';
import { installApi, renderApp, resetAppState, installFakeSupabase } from './helpers/app';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US' }, { languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

describe('root layout (app/_layout)', () => {
  beforeEach(async () => {
    await resetAppState();
    installApi({});
  });

  it('loads the kit fonts under the families the kit requires', () => {
    expect(Object.keys(APP_FONTS).sort()).toEqual([...REQUIRED_FONT_FAMILIES].sort());
  });

  it('boots the providers, picks the device language and resolves the first route', async () => {
    installFakeSupabase(null);
    const { router } = await renderApp('/');
    const en = loadMessages('en').auth;
    expect(await screen.findByText(en.signUp.title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });
});
