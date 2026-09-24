import './globals.css';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NotFoundContent } from '@/components/layout/NotFoundContent.tsx';

const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: 'tr', namespace: 'webPages.seo.notFound' });
  return {
    title: t('title'),
    description: t('description'),
    robots: { index: false, follow: false },
  };
}

/**
 * W-ERR-01 for URLs that match no route at all (for example a file-like path the locale router
 * does not handle). Rendered in the default locale.
 */
export default function GlobalNotFound(): ReactNode {
  return (
    <html lang="tr" className={geist.variable}>
      <body className="bg-bg font-sans text-ink">
        <NotFoundContent locale="tr" homeHref="/" />
      </body>
    </html>
  );
}
