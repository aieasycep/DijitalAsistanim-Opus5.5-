import '../globals.css';
import { color } from '@da/design-tokens';
import type { Metadata, Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Geist, Geist_Mono, Lora } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteBehaviors } from '@/components/analytics/SiteBehaviors.tsx';
import { clientEnv } from '@/env/client.ts';
import { isWebLocale } from '@/i18n/locales.ts';
import { loadWebPages } from '@/i18n/messages.ts';
import { routing } from '@/i18n/routing.ts';

/** Geist (UI) and Lora (editorial), self-hosted by next/font with Turkish glyphs (latin-ext). */
const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist', display: 'swap' });
const lora = Lora({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-lora',
  display: 'swap',
  weight: ['400', '500'],
});
const geistMono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
});

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: requested } = await params;
  const locale = isWebLocale(requested) ? requested : 'tr';
  const t = await getTranslations({ locale, namespace: 'webPages.seo.notFound' });
  return {
    metadataBase: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
    applicationName: 'Dijital Asistan',
    // Every page sets its own title; only the localized 404 falls back to this one.
    title: t('title'),
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: color.light.bg },
    { media: '(prefers-color-scheme: dark)', color: color.dark.bg },
  ],
  colorScheme: 'light dark',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <html lang={locale} className={`${geist.variable} ${lora.variable} ${geistMono.variable}`}>
      <body className="bg-bg font-sans text-ink antialiased">
        {/* Client components here need the locale and the error copy; pages with client forms pass their own subset. */}
        <NextIntlClientProvider messages={{ webPages: { errors: loadWebPages(locale).errors } }}>
          <SiteBehaviors />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
