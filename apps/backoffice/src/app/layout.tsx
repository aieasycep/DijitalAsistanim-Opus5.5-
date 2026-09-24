import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';

import { CspNonce } from '@/components/csp-nonce';
import { ToastProvider } from '@/components/ui/toast';
import { THEME_COOKIE, parseTheme } from '@/server/preference-cookies';

import './globals.css';

/* Geist and Geist Mono, self-hosted by next/font at build time (no runtime third-party requests). */
const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice');
  return {
    title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

/** Light is the default; the theme cookie (mirrored from `admin_preferences`) sets `data-theme`. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, t, store, requestHeaders] = await Promise.all([
    getLocale(),
    getTranslations('backoffice'),
    cookies(),
    headers(),
  ]);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme} className={`${geist.variable} ${geistMono.variable}`}>
      <body className="bg-bg text-ink antialiased">
        <CspNonce nonce={requestHeaders.get('x-nonce')} />
        <NextIntlClientProvider>
          <NuqsAdapter>
            <ToastProvider label={t('shell.toasts')}>{children}</ToastProvider>
          </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
