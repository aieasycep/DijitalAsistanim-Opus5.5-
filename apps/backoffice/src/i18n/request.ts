import { loadNamespaces } from '@da/i18n';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { LOCALE_COOKIE, parseLocale } from '@/server/preference-cookies';

/*
 * next-intl without locale routing (BACKOFFICE_PLAN §5.8): Turkish by default, English complete. The
 * locale comes from the admin's preference (mirrored into `__Host-da_admin_locale` at sign-in and on
 * change). Only the `backoffice` namespace ships; mobile and web copy never reach this app.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: loadNamespaces(locale, ['backoffice']),
    timeZone: 'Europe/Istanbul',
    formats: {
      dateTime: {
        short: { day: '2-digit', month: '2-digit', year: 'numeric' },
        long: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        },
      },
    },
    getMessageFallback: ({ key, namespace }) => [namespace, key].filter(Boolean).join('.'),
    onError: (error) => {
      console.error(JSON.stringify({ level: 'error', msg: 'i18n_error', code: error.code }));
    },
  };
});
