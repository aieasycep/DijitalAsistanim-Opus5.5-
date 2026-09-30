import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/JsonLd.tsx';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView.tsx';
import { DevNotice } from '@/components/ui/DevNotice.tsx';
import { legalDocument } from '@/content/legal/index.ts';
import { webPageLd } from '@/lib/json-ld.ts';
import { localizedPath, pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.terms' });
  return pageMetadata({
    locale,
    path: '/terms',
    title: t('title'),
    description: t('description'),
    indexable: siteConfig().indexable,
  });
}

/** W-LEGAL-02 · Kullanım Koşulları. */
export default async function TermsPage({ params }: Props): Promise<ReactNode> {
  const { locale } = await params;
  const config = siteConfig();
  const doc = legalDocument('terms', locale, config.legal);
  return (
    <main id="main" tabIndex={-1} data-page="terms" className="focus-visible:outline-none">
      <JsonLd
        data={webPageLd({
          url: `${config.siteUrl}${localizedPath(locale, '/terms')}`,
          name: doc.title,
          locale,
          dateModified: doc.effectiveDate,
        })}
      />
      <LegalDocumentView
        doc={doc}
        locale={locale}
        backupDays={config.legal.backupDays}
        subprocessors={[]}
        notice={<DevNotice keys={config.company.missing} production={config.production} />}
      />
    </main>
  );
}
