/**
 * Turkish-aware case mapping (ADR-03, ADR-14). Kickers and badges are rendered upper-case with
 * `toUpper(text, locale)`, never with `textTransform: 'uppercase'`, which maps "i" to "I" instead
 * of "İ". The dotted/dotless i pairs are mapped explicitly so the result does not depend on the
 * JavaScript engine's locale data (Hermes, V8, JavaScriptCore).
 */
import type { Locale } from './locales.ts';

export function toUpper(text: string, locale: Locale): string {
  if (locale !== 'tr') return text.toUpperCase();
  return text.replaceAll('i', 'İ').replaceAll('ı', 'I').toUpperCase();
}

export function toLower(text: string, locale: Locale): string {
  if (locale !== 'tr') return text.toLowerCase();
  return text.replaceAll('I', 'ı').replaceAll('İ', 'i').toLowerCase();
}

/** Upper-cases the first character only: "bugün" → "Bugün", "istanbul" → "İstanbul". */
export function capitalizeFirst(text: string, locale: Locale): string {
  const first = text.charAt(0);
  return first === '' ? text : `${toUpper(first, locale)}${text.slice(1)}`;
}

/**
 * Folds text for local search (Help, licenses, timezone list): Turkish lower-casing, then accents
 * removed and ı/i unified, so "ISTANBUL", "İstanbul" and "istanbul" all match, as do "sifre" and
 * "Şifre".
 */
export function foldForSearch(text: string, locale: Locale = 'tr'): string {
  return toLower(text, locale)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('ı', 'i')
    .trim();
}
