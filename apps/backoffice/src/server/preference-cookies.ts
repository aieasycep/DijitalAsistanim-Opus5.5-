import { DEFAULT_LOCALE, isLocale, type Locale } from '@da/i18n';

/*
 * UI preference cookies (BACKOFFICE_PLAN §3.8, §6.24). The server renders `<html data-theme lang>`
 * from them, so there is no flash and no inline script. `admin_preferences` (via admin-api
 * `PATCH /preferences`) stays the source of truth across browsers and devices; the cookies are
 * refreshed from it at sign-in and on every change.
 */

export const THEME_COOKIE = '__Host-da_admin_theme';
export const LOCALE_COOKIE = '__Host-da_admin_locale';
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** One year; the value is not sensitive. `__Host-` requires Secure, Path=/ and no Domain. */
export const PREFERENCE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 31_536_000,
} as const;

export function parseTheme(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

export function parseLocale(value: string | undefined): Locale {
  if (value === undefined) return DEFAULT_LOCALE;
  const primary = value.split('-')[0]?.toLowerCase();
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}
