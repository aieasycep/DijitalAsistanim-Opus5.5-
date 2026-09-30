import 'server-only';

import { getLocale } from 'next-intl/server';

import { createFormatters, type Formatters } from '@/lib/formatters';
import { loadAdminContext } from './session';

/** Formatters for server components: the request locale and the admin's timezone preference. */
export async function getFormatters(): Promise<Formatters> {
  const [locale, context] = await Promise.all([getLocale(), loadAdminContext()]);
  return createFormatters(locale, context.preferences.timezone);
}
