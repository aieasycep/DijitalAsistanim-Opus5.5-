import type { Locale } from '@da/i18n';

/**
 * The site's locales, identical to `@da/i18n` `LOCALES` (a unit test pins the equality). They are
 * declared here, with a type-only import, because client components must not import the
 * `@da/i18n` entry point: it statically imports every message catalog of the mobile app.
 */
export const WEB_LOCALES = ['tr', 'en'] as const satisfies readonly Locale[];
export const WEB_DEFAULT_LOCALE: Locale = 'tr';

export type { Locale };

export function isWebLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (WEB_LOCALES as readonly string[]).includes(value);
}

/** BCP 47 tags for `Intl` (same as `@da/i18n` `INTL_LOCALE`). */
export const INTL_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

/** Open Graph locale tags (Part 5 §13). */
export const OG_LOCALE: Readonly<Record<Locale, string>> = { tr: 'tr_TR', en: 'en_US' };

/**
 * Locale for the locale-neutral link pages (`/r`, `/oauth/done`, `/app`): `?lang=` first, then
 * `Accept-Language` (`tr*` → tr, anything else → en), then Turkish (Part 5 §0.2).
 */
export function resolveLinkLocale(lang: string | null, acceptLanguage: string | null): Locale {
  if (isWebLocale(lang)) return lang;
  if (acceptLanguage !== null && acceptLanguage.trim() !== '') {
    const ranked = acceptLanguage
      .split(',')
      .map((part, index) => {
        const [tag = '', ...params] = part.trim().split(';');
        const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
        const quality = q === undefined ? 1 : Number.parseFloat(q.slice(2));
        return { tag: tag.toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality, index };
      })
      .filter((entry) => entry.tag !== '' && entry.quality > 0)
      .sort((a, b) => b.quality - a.quality || a.index - b.index);
    const first = ranked[0];
    if (first !== undefined) return first.tag === 'tr' || first.tag.startsWith('tr-') ? 'tr' : 'en';
  }
  return WEB_DEFAULT_LOCALE;
}
