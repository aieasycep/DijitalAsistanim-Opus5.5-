/**
 * Typed keys for use-intl (mobile) and next-intl (web, backoffice; next-intl re-exports use-intl's
 * `AppConfig`). Apps opt in with one type-only import, e.g. in `apps/mobile/src/i18n.d.ts`:
 *
 *   import type {} from '@da/i18n/use-intl';
 *
 * After that, `useTranslations('today')('hero.title')` is checked against the Turkish catalog and a
 * missing key is a compile error (ADR-24).
 */
import type {} from 'use-intl';

import type { Locale } from './locales.ts';
import type { Messages } from './messages.ts';

declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}

export type { Locale, Messages };
