import type { Locale } from '@da/i18n';
import type { WebMessages } from './messages.ts';

/**
 * Typed next-intl keys for the web: the shared `@da/i18n` catalog plus the site's `webPages`
 * namespace. This replaces `import type {} from '@da/i18n/use-intl'`, whose `AppConfig` would
 * declare the shared catalog alone and make every `webPages.*` key a compile error.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: WebMessages;
  }
}

export {};
