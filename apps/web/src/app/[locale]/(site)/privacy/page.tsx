import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/JsonLd.tsx';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView.tsx';
import { DevNotice } from '@/components/ui/DevNotice.tsx';
import { legalDocument } from '@/content/legal/index.ts';
import { buildSubprocessors } from '@/content/subprocessors.ts';
import { serverEnv } from '@/env/server.ts';
import { webPageLd } from '@/lib/json-ld.ts';
import { localizedPath, pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.privacy' });
  return pageMetadata({
    locale,
    path: '/privacy',
    title: t('title'),
    description: t('description'),
    indexable: siteConfig().indexable,
  });
}

/** W-LEGAL-01 · Gizlilik Politikası ve KVKK Aydınlatma Metni. */
export default async function PrivacyPage({ params }: Props): Promise<ReactNode> {
  const { locale } = await params;
  const config = siteConfig();
  const env = serverEnv();
  const doc = legalDocument('privacy', locale, config.legal);
  const subprocessors = buildSubprocessors({
    dataRegionLabel: env.DATA_REGION_LABEL,
    sentryRegionLabel: env.SENTRY_REGION_LABEL,
    emailProvider: env.EMAIL_PROVIDER,
    turnstileEnabled: config.turnstileSiteKey !== undefined,
  });
  return (
    <main id="main" tabIndex={-1} data-page="privacy" className="focus-visible:outline-none">
      <JsonLd
        data={webPageLd({
          url: `${config.siteUrl}${localizedPath(locale, '/privacy')}`,
          name: doc.title,
          locale,
          dateModified: doc.effectiveDate,
        })}
      />
      <LegalDocumentView
        doc={doc}
        locale={locale}
        backupDays={config.legal.backupDays}
        subprocessors={subprocessors}
        notice={<DevNotice keys={config.company.missing} production={config.production} />}
      />
    </main>
  );
}
