import { getRequestConfig } from 'next-intl/server';
import { locale as rootLocale } from 'next/root-params';
import { isWebLocale, WEB_DEFAULT_LOCALE } from './locales.ts';
import { loadWebMessages } from './messages.ts';

/**
 * next-intl request configuration. The locale is the `[locale]` root parameter
 * (`next/root-params`), or an explicit `locale` passed to `getTranslations({ locale })` (used by
 * metadata, Open Graph images and the global 404 page). Unknown values fall back to Turkish; the
 * root layout turns them into a 404 before any page renders.
 */
export default getRequestConfig(async ({ locale }) => {
  const candidate = locale ?? (await rootLocale());
  const resolved = isWebLocale(candidate) ? candidate : WEB_DEFAULT_LOCALE;
  return {
    locale: resolved,
    messages: loadWebMessages(resolved),
    timeZone: 'Europe/Istanbul',
  };
});
