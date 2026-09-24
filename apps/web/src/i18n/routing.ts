import { defineRouting } from 'next-intl/routing';
import { WEB_DEFAULT_LOCALE, WEB_LOCALES } from './locales.ts';

/**
 * Locale routing (ADR-14; SCREEN_AND_FLOW_MAP Part 5 §0.2): Turkish is served without a prefix,
 * English under `/en`. The site is cookieless and never redirects by `Accept-Language`, so every
 * URL is stable and canonical (§0.11).
 */
export const routing = defineRouting({
  locales: WEB_LOCALES,
  defaultLocale: WEB_DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});
