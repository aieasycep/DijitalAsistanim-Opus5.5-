/**
 * use-intl provider with the shared ICU catalogs (ADR-14, ADR-24): Turkish by default, English
 * when the device prefers it. An explicit `locale` (the in-app language setting, tests) wins over
 * the device's preference list.
 */
import { DEFAULT_TIME_ZONE, loadMessages, resolveLocale, type Locale } from '@da/i18n';
import { getCalendars, getLocales } from 'expo-localization';
import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';

/** The best supported locale for the device's preferred languages (falls back to `tr`). */
export function deviceLocale(): Locale {
  return resolveLocale(getLocales().map((locale) => locale.languageTag));
}

/** The device's IANA time zone, or Europe/Istanbul when the OS does not report one. */
export function deviceTimeZone(): string {
  return getCalendars()[0].timeZone ?? DEFAULT_TIME_ZONE;
}

interface I18nProviderProps {
  readonly children: ReactNode;
  readonly locale?: Locale;
  readonly timeZone?: string;
}

export function I18nProvider({ children, locale, timeZone }: I18nProviderProps) {
  const active = locale ?? deviceLocale();
  return (
    <IntlProvider
      locale={active}
      messages={loadMessages(active)}
      timeZone={timeZone ?? deviceTimeZone()}
    >
      {children}
    </IntlProvider>
  );
}
