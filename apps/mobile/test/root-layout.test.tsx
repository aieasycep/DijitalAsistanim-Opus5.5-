import { loadMessages } from '@da/i18n';
import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen } from 'expo-router/testing-library';

import RootLayout from '../app/_layout';
import LaunchRoute from '../app/index';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US' }, { languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

describe('root layout (app/_layout)', () => {
  it('loads the fonts, picks the device language and renders the launch route', async () => {
    const router = renderRouter({ _layout: RootLayout, index: LaunchRoute });
    // RNTL 14 renders asynchronously while renderRouter is typed as synchronous: adopt the render.
    await Promise.resolve(router);
    const en = loadMessages('en').common.app;
    expect(await screen.findByText(en.tagline)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en.name })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });
});
