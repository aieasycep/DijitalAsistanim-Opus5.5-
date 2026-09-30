'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import { useAdmin } from '@/components/admin-provider';
import { DEFAULT_TIMEZONE } from './format';
import { createFormatters, type Formatters } from './formatters';

/** Formatters for client islands: the UI locale and the admin's timezone preference. */
export function useFormatters(): Formatters {
  const locale = useLocale();
  const admin = useAdmin();
  const timeZone = admin?.preferences.timezone ?? DEFAULT_TIMEZONE;
  return useMemo(() => createFormatters(locale, timeZone), [locale, timeZone]);
}
