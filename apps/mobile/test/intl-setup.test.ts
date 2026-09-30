/**
 * KPL-27: the app entry repairs `Intl` before the router entry loads, and Sentry tags engines that
 * needed a fallback.
 */
import { describe, expect, it, jest } from '@jest/globals';

import type * as IntlSetup from '../src/lib/intl-setup';
import type * as SentryModule from '../src/lib/sentry';

describe('Intl repair at startup (KPL-27)', () => {
  it('runs ensureIntl before expo-router/entry', () => {
    const order: string[] = [];
    jest.isolateModules(() => {
      jest.doMock('@da/i18n', () => ({
        ...jest.requireActual<Record<string, unknown>>('@da/i18n'),
        ensureIntl: () => {
          order.push('ensureIntl');
          return { pluralRules: 'native', timeZones: 'native' };
        },
      }));
      jest.doMock('expo-router/entry', () => {
        order.push('router');
        return {};
      });
      jest.requireActual('../index');
    });
    expect(order).toEqual(['ensureIntl', 'router']);
  });

  it('reports the engine as complete under the test runtime', () => {
    jest.isolateModules(() => {
      const { intlReport } = jest.requireActual<typeof IntlSetup>('../src/lib/intl-setup');
      expect(intlReport).toEqual({ pluralRules: 'native', timeZones: 'native' });
    });
  });

  it('tags Sentry events when a fallback is in use', () => {
    jest.isolateModules(() => {
      jest.doMock('../src/lib/intl-setup', () => ({
        intlReport: { pluralRules: 'polyfilled', timeZones: 'offset_shim' },
      }));
      const Sentry = jest.requireMock<{ setTag: jest.Mock }>('@sentry/react-native');
      Sentry.setTag.mockClear();
      const { initSentry } = jest.requireActual<typeof SentryModule>('../src/lib/sentry');
      expect(
        initSentry({
          EXPO_PUBLIC_SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
          EXPO_PUBLIC_APP_ENV: 'preview',
        } as never),
      ).toBe(true);
      expect(Sentry.setTag).toHaveBeenCalledWith('intl_fallback', 'plural_rules,tz_offset_shim');
    });
  });

  it('adds no tag on a complete engine', () => {
    jest.isolateModules(() => {
      jest.doMock('../src/lib/intl-setup', () => ({
        intlReport: { pluralRules: 'native', timeZones: 'native' },
      }));
      const Sentry = jest.requireMock<{ setTag: jest.Mock }>('@sentry/react-native');
      Sentry.setTag.mockClear();
      const { initSentry } = jest.requireActual<typeof SentryModule>('../src/lib/sentry');
      initSentry({
        EXPO_PUBLIC_SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
        EXPO_PUBLIC_APP_ENV: 'preview',
      } as never);
      expect(Sentry.setTag).not.toHaveBeenCalledWith('intl_fallback', expect.anything());
    });
  });
});
