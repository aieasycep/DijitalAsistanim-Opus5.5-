import { color } from '@da/design-tokens';
import { loadMessages } from '@da/i18n';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import * as Localization from 'expo-localization';
import { StyleSheet } from 'react-native';

import { LaunchScreen } from '../src/features/launch/LaunchScreen';
import { deviceLocale, deviceTimeZone, I18nProvider } from '../src/i18n/I18nProvider';
import { useSchemeName } from '../src/lib/useSchemeName';

jest.mock('../src/lib/useSchemeName', () => ({ useSchemeName: jest.fn(() => 'light') }));
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const schemeName = jest.mocked(useSchemeName);
const localization = jest.mocked(Localization);

function renderLaunch(locale: 'tr' | 'en', busy = false) {
  return render(
    <I18nProvider locale={locale} timeZone="Europe/Istanbul">
      <LaunchScreen busy={busy} />
    </I18nProvider>,
  );
}

describe('launch view (M-GL-02 entry resolver while loading)', () => {
  beforeEach(() => {
    schemeName.mockReturnValue('light');
  });

  it('shows the app name and the PRIMARY brand line in Turkish', async () => {
    await renderLaunch('tr');
    expect(screen.getByRole('header', { name: 'Dijital Asistan' })).toBeOnTheScreen();
    expect(screen.getByText('Bugün bilmen gerekenleri, sen sormadan söyler.')).toBeOnTheScreen();
  });

  it('shows the English catalog copy', async () => {
    await renderLaunch('en');
    const en = loadMessages('en').common.app;
    expect(screen.getByRole('header', { name: en.name })).toBeOnTheScreen();
    expect(screen.getByText(en.tagline)).toBeOnTheScreen();
    expect(screen.queryByText(loadMessages('tr').common.app.tagline)).toBeNull();
  });

  it('paints the token background in light and dark', async () => {
    await renderLaunch('tr');
    const light = StyleSheet.flatten(screen.getByTestId('launch-screen').props.style as object);
    expect(light).toMatchObject({ backgroundColor: color.light.bg });
    schemeName.mockReturnValue('dark');
    await renderLaunch('tr');
    const dark = StyleSheet.flatten(screen.getByTestId('launch-screen').props.style as object);
    expect(dark).toMatchObject({ backgroundColor: color.dark.bg });
    expect(screen.getByText('Dijital Asistan')).toHaveStyle({ color: color.dark.text.primary });
  });

  it('keeps the brand tile out of the accessibility tree', async () => {
    await renderLaunch('tr');
    expect(screen.queryByRole('image')).toBeNull();
    expect(screen.queryByTestId('launch-spinner')).toBeNull();
  });

  it('shows the labelled 16 px spinner when the entry route is slow', async () => {
    await renderLaunch('tr', true);
    const spinner = screen.getByTestId('launch-spinner');
    expect(spinner.props).toMatchObject({
      accessibilityRole: 'progressbar',
      accessibilityLabel: 'Dijital Asistan yükleniyor',
      size: 16,
    });
    expect(screen.getByTestId('launch-screen').props.accessibilityLabel).toBe(
      'Dijital Asistan yükleniyor',
    );
  });
});

describe('device locale', () => {
  it('prefers a supported device language and falls back to Turkish', () => {
    localization.getLocales.mockReturnValueOnce([{ languageTag: 'en-GB' }] as never);
    expect(deviceLocale()).toBe('en');
    localization.getLocales.mockReturnValueOnce([{ languageTag: 'de-DE' }] as never);
    expect(deviceLocale()).toBe('tr');
  });

  it('uses Europe/Istanbul when the OS reports no time zone', () => {
    localization.getCalendars.mockReturnValueOnce([{ timeZone: null }] as never);
    expect(deviceTimeZone()).toBe('Europe/Istanbul');
  });
});
