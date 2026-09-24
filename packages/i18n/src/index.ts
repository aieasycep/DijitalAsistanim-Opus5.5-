/**
 * @da/i18n — ICU message catalogs (`tr` default, `en` complete) shared by use-intl on mobile and
 * next-intl on web and backoffice, plus Hermes-safe formatting, date-fns relative time, Turkish
 * case suffixes and a pseudo-locale. See STYLE.md for tone and key conventions.
 */
export {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  LOCALES,
  LOCALE_NATIVE_NAME,
  isLocale,
  resolveLocale,
  type Locale,
} from './locales.ts';
export { NAMESPACES, isNamespace, type Namespace } from './namespaces.ts';
export {
  loadMessages,
  loadNamespaces,
  lookupMessage,
  type MessageKey,
  type Messages,
} from './messages.ts';
export * from './formats.ts';
export * from './relative-time.ts';
export * from './tr-suffix.ts';
export * from './case.ts';
export * from './pseudo.ts';
export * from './faq.ts';
export * from './keys.ts';
