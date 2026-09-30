import { loadMessages, type Locale, type Messages as SharedMessages } from '@da/i18n';
import enWebPages from '../../messages/en/webPages.json';
import trWebPages from '../../messages/tr/webPages.json';

/**
 * The web catalog = the shared `@da/i18n` catalog (`web`, `legal`, `faq`, `common`, `paywall`, …)
 * plus the site's own page copy in `apps/web/messages/<locale>/webPages.json` (namespace
 * `webPages`). Turkish is the source of truth for the shape; English is typed against it, so a key
 * missing in `en` is a compile error.
 */
export type WebPagesMessages = typeof trWebPages;
export type WebMessages = SharedMessages & { webPages: WebPagesMessages };

const WEB_PAGES: Readonly<Record<Locale, WebPagesMessages>> = {
  tr: trWebPages,
  en: enWebPages satisfies WebPagesMessages,
};

export function loadWebPages(locale: Locale): WebPagesMessages {
  return WEB_PAGES[locale];
}

export function loadWebMessages(locale: Locale): WebMessages {
  return { ...loadMessages(locale), webPages: WEB_PAGES[locale] };
}
