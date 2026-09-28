import type { Locale } from '@da/i18n';
import { createTranslator } from 'next-intl';
import { loadWebMessages } from '../../src/i18n/messages.ts';
import { requestLocale } from './request-locale.ts';

export { requestLocale };

/**
 * Stand-in for `next-intl/server` in page tests: translators over the real web catalog, with the
 * request locale settable per test (`requestLocale.current`). Nothing is mocked about the copy.
 */
type TranslationsArg = string | { locale?: Locale; namespace?: string } | undefined;

export function getTranslations(arg?: TranslationsArg): Promise<unknown> {
  const options = typeof arg === 'string' ? { namespace: arg } : (arg ?? {});
  const locale = options.locale ?? requestLocale.current;
  return Promise.resolve(
    createTranslator({
      locale,
      messages: loadWebMessages(locale),
      ...(options.namespace === undefined ? {} : { namespace: options.namespace as never }),
      timeZone: 'Europe/Istanbul',
    }),
  );
}

export function getLocale(): Promise<Locale> {
  return Promise.resolve(requestLocale.current);
}

export function getMessages(): Promise<unknown> {
  return Promise.resolve(loadWebMessages(requestLocale.current));
}

export function setRequestLocale(locale: Locale): void {
  requestLocale.current = locale;
}

export function getRequestConfig<T>(factory: T): T {
  return factory;
}
