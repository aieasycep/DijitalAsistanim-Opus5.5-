/**
 * R-21 demo route (`app/demo/setup`): compiled only into demo builds (Metro `blockList` from
 * `demo-routes.js`), allow-listed only there, strict query validation, and — in a demo build —
 * clears the local cache, pins the clock, applies language and theme and returns to the entry
 * resolver. Outside demo builds the route shows not-found (see `shell.test.tsx`).
 */
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from 'expo-router/testing-library';

import { parseDemoSetup } from '../src/features/demo/DemoSetupScreen';
import { now, unpinClock } from '../src/lib/clock';
import { isScreenAvailable } from '../src/lib/deeplinks';
import { getQueryClient } from '../src/lib/query/client';
import { getUiPrefs } from '../src/lib/ui-prefs';
import { installApi, json, renderApp, resetAppState, installFakeSupabase } from './helpers/app';
import { bootstrap, ok, session } from './helpers/fixtures';

const { demoRouteBlockList, isDemoMode } = jest.requireActual<{
  demoRouteBlockList: (env: Record<string, string | undefined>, root: string) => RegExp[];
  isDemoMode: (env: Record<string, string | undefined>) => boolean;
}>('../demo-routes.js');

jest.mock('../src/lib/env', () => ({
  ...jest.requireActual<Record<string, unknown>>('../src/lib/env'),
  isDemoBuild: () => true,
}));
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

describe('demo route build gate (metro blockList)', () => {
  const root = '/repo/apps/mobile';

  it('is on only for EXPO_PUBLIC_DEMO_MODE=true or 1', () => {
    expect(isDemoMode({ EXPO_PUBLIC_DEMO_MODE: 'true' })).toBe(true);
    expect(isDemoMode({ EXPO_PUBLIC_DEMO_MODE: '1' })).toBe(true);
    expect(isDemoMode({ EXPO_PUBLIC_DEMO_MODE: 'false' })).toBe(false);
    expect(isDemoMode({ EXPO_PUBLIC_DEMO_MODE: 'yes' })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });

  it('drops app/demo/** from every other bundle and nothing else', () => {
    const [rule, ...rest] = demoRouteBlockList({}, root);
    expect(rest).toEqual([]);
    expect(rule?.test(path.join(root, 'app/demo/setup.tsx'))).toBe(true);
    expect(rule?.test(path.join(root, 'app/demo'))).toBe(true);
    expect(rule?.test(path.join(root, 'app/demographics.tsx'))).toBe(false);
    expect(rule?.test(path.join(root, 'app/(tabs)/today/index.tsx'))).toBe(false);
    expect(demoRouteBlockList({ EXPO_PUBLIC_DEMO_MODE: 'true' }, root)).toEqual([]);
  });

  it('lists the screen as available only in demo builds', () => {
    expect(isScreenAvailable('/demo/setup', false)).toBe(false);
    expect(isScreenAvailable('/demo/setup', true)).toBe(true);
  });
});

describe('parseDemoSetup', () => {
  it('accepts the documented parameters', () => {
    expect(
      parseDemoSetup({
        scenario: 'standard',
        clock: '2026-09-23T08:00:00Z',
        locale: 'en',
        theme: 'dark',
      }),
    ).toEqual({
      scenario: 'standard',
      clock: new Date('2026-09-23T08:00:00Z'),
      locale: 'en',
      theme: 'dark',
    });
    expect(parseDemoSetup({})).toEqual({ scenario: null, clock: null, locale: null, theme: null });
  });

  it('rejects the whole link when any parameter is malformed', () => {
    expect(parseDemoSetup({ scenario: '../etc' })).toBeNull();
    expect(parseDemoSetup({ clock: 'yesterday' })).toBeNull();
    expect(parseDemoSetup({ locale: 'de' })).toBeNull();
    expect(parseDemoSetup({ theme: 'sepia' })).toBeNull();
  });
});

describe('demo setup in a demo build', () => {
  it('resets the local cache, pins the clock, applies language and theme, then enters the app', async () => {
    await resetAppState();
    unpinClock();
    installFakeSupabase(session());
    installApi({ 'GET /me/bootstrap': () => json(200, ok(bootstrap())) });
    getQueryClient().setQueryData(['stale', 'screen'], { from: 'before the demo reset' });

    const { router } = await renderApp(
      '/demo/setup?scenario=standard&clock=2026-09-23T08:00:00Z&locale=en&theme=dark',
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(getQueryClient().getQueryData(['stale', 'screen'])).toBeUndefined();
    expect(Math.abs(now().getTime() - Date.parse('2026-09-23T08:00:00Z'))).toBeLessThan(60_000);
    expect(getUiPrefs()).toMatchObject({ locale: 'en', theme: 'dark' });
    expect(await screen.findByRole('tab', { name: 'Today, tab 1 of 4' })).toBeOnTheScreen();
    unpinClock();
  });

  it('shows an invalid demo link instead of acting on it', async () => {
    await resetAppState();
    installFakeSupabase(session());
    installApi({ 'GET /me/bootstrap': () => json(200, ok(bootstrap())) });
    await renderApp('/demo/setup?theme=sepia');
    expect(await screen.findByText('Bu demo bağlantısı geçersiz.')).toBeOnTheScreen();
  });
});
