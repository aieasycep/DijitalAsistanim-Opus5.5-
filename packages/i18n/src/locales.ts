/**
 * Supported locales (ADR-14, M§39): Turkish is the default, English is complete. Locale-neutral
 * code (formatters, suffix helpers) takes a `Locale` and maps it to a BCP 47 tag where `Intl` needs
 * one. RTL is out of scope (KNOWN_PLATFORM_LIMITATIONS).
 */

export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'tr';

/** BCP 47 tags used for `Intl.NumberFormat` and locale-sensitive string operations. */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  tr: 'tr-TR',
  en: 'en-US',
};

/** Human-readable names shown in the language picker, each in its own language. */
export const LOCALE_NATIVE_NAME: Readonly<Record<Locale, string>> = {
  tr: 'Türkçe',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from a tag or a preference list (e.g. `expo-localization`
 * `getLocales()` tags or an `Accept-Language` split). Matching is on the primary subtag; anything
 * unsupported falls back to Turkish.
 */
export function resolveLocale(input: string | readonly string[] | null | undefined): Locale {
  const candidates = typeof input === 'string' ? [input] : (input ?? []);
  for (const candidate of candidates) {
    const primary = candidate.trim().toLowerCase().split(/[-_;]/)[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
