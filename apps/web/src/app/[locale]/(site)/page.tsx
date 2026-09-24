import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/JsonLd.tsx';
import { DownloadBand } from '@/components/landing/DownloadBand.tsx';
import { Features } from '@/components/landing/Features.tsx';
import { Hero } from '@/components/landing/Hero.tsx';
import { HomeFaq } from '@/components/landing/HomeFaq.tsx';
import { HowItWorks } from '@/components/landing/HowItWorks.tsx';
import { Integrations } from '@/components/landing/Integrations.tsx';
import { PricingTeaser } from '@/components/landing/PricingTeaser.tsx';
import { Security } from '@/components/landing/Security.tsx';
import { mobileApplicationLd, organizationLd, websiteLd } from '@/lib/json-ld.ts';
import { freeLimits, pricingView } from '@/lib/pricing.ts';
import { getPlansSnapshot } from '@/lib/public-api/server.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { buildStoreLinks } from '@/lib/store-links.ts';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.home' });
  const config = siteConfig();
  return pageMetadata({
    locale,
    path: '/',
    title: t('title'),
    description: t('description'),
    indexable: config.indexable,
    iosAppStoreId: config.store.iosAppStoreId,
  });
}

/** W-HOME-01 · the twelve M§73 sections in order. */
export default async function HomePage({ params }: Props): Promise<ReactNode> {
  const { locale } = await params;
  const config = siteConfig();
  const { plans, checkedAt } = await getPlansSnapshot();
  const limits = freeLimits(plans);
  const pricing = pricingView(plans?.pricing ?? null, new Date(checkedAt));
  const seo = await getTranslations({ locale, namespace: 'webPages.seo.home' });
  const links = buildStoreLinks(config.store, locale, 'hero');

  return (
    <main id="main" tabIndex={-1} data-page="home" className="focus-visible:outline-none">
      <JsonLd
        data={[
          organizationLd({
            siteUrl: config.siteUrl,
            legalName: config.company.legalName,
            storeUrls: [links.appStore, links.play].filter((url): url is string => url !== null),
          }),
          websiteLd(config.siteUrl),
          mobileApplicationLd({
            siteUrl: config.siteUrl,
            description: seo('description'),
            pricing,
          }),
        ]}
      />
      <Hero
        locale={locale}
        store={config.store}
        siteUrl={config.siteUrl}
        devMissing={config.devMissing}
        production={config.production}
      />
      <Integrations limits={limits} />
      <HowItWorks />
      <Features locale={locale} />
      <Security dataRegionLabel={config.dataRegionLabel} />
      <PricingTeaser locale={locale} limits={limits} pricing={pricing} />
      <HomeFaq limits={limits} microsoftClientId={config.microsoftClientId} />
      <DownloadBand
        locale={locale}
        store={config.store}
        siteUrl={config.siteUrl}
        placement="final"
        qrPlacement="qr_final"
      />
    </main>
  );
}
