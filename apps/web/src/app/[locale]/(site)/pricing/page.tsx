import { toUpper, type Locale } from '@da/i18n';
import { formatCalendarDate } from '@/lib/dates.ts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FaqList } from '@/components/faq/FaqList.tsx';
import { renderFaqItems } from '@/components/faq/faq-content.tsx';
import { JsonLd } from '@/components/JsonLd.tsx';
import { DownloadBand } from '@/components/landing/DownloadBand.tsx';
import { ComparisonTable } from '@/components/pricing/ComparisonTable.tsx';
import { PricingPlans, type PlanPrices } from '@/components/pricing/PricingPlans.tsx';
import { Kicker } from '@/components/ui/Section.tsx';
import { mobileApplicationLd } from '@/lib/json-ld.ts';
import {
  formatPercentRange,
  formatTry,
  formatTryRange,
  freeLimits,
  pricingView,
  type PricingView,
} from '@/lib/pricing.ts';
import { getPlansSnapshot } from '@/lib/public-api/server.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.pricing' });
  const config = siteConfig();
  return pageMetadata({
    locale,
    path: '/pricing',
    title: t('title'),
    description: t('description'),
    indexable: config.indexable,
  });
}

async function planPrices(locale: Locale, view: PricingView | null): Promise<PlanPrices | null> {
  if (view === null) return null;
  const paywall = await getTranslations('paywall');
  const web = await getTranslations('web.pricing');
  return {
    monthly: paywall('pricePerMonth', { price: formatTryRange(view.monthly, locale) }),
    annual: paywall('pricePerYear', { price: formatTryRange(view.annual, locale) }),
    annualBreakdown:
      view.savings === null
        ? null
        : paywall('annualBreakdown', {
            price: formatTryRange(view.annualPerMonth, locale),
            percent: formatPercentRange(view.savings),
          }),
    showBestValue: view.savings !== null,
    storeNote: web('storeNote', { asOf: formatCalendarDate(view.asOf, locale) }),
  };
}

/** W-PRICE-01 · store-authoritative prices, the Free/Pro comparison, billing questions. */
export default async function PricingPage({ params }: Props): Promise<ReactNode> {
  const { locale } = await params;
  const config = siteConfig();
  const { plans, checkedAt } = await getPlansSnapshot();
  const limits = freeLimits(plans);
  const view = pricingView(plans?.pricing ?? null, new Date(checkedAt));
  const trialDays = view?.introOfferDays ?? null;
  const web = await getTranslations('web.pricing');
  const paywall = await getTranslations('paywall');
  const page = await getTranslations('webPages.pricing');
  const seo = await getTranslations('webPages.seo.pricing');
  const faq = await renderFaqItems({
    keys: ['billing', 'trial', 'restore', 'refund', 'referral', 'pro_ends'],
    limits,
    microsoftClientId: config.microsoftClientId,
  });

  return (
    <main id="main" tabIndex={-1} data-page="pricing" className="focus-visible:outline-none">
      <JsonLd
        data={mobileApplicationLd({
          siteUrl: config.siteUrl,
          description: seo('description'),
          pricing: view,
        })}
      />
      <section
        aria-labelledby="pricing-title"
        className="pt-12 pb-10 md:pt-16 xl:pt-20 [background:var(--da-gradient-onboarding-tint)]"
      >
        <div className="site-container">
          <Kicker>{toUpper(web('kicker'), locale)}</Kicker>
          <h1
            id="pricing-title"
            className="mt-4 max-w-3xl text-web-hero-sm text-balance md:text-web-hero-md xl:text-web-hero-lg"
          >
            {web('title')}
          </h1>
          <p className="mt-5 max-w-2xl text-web-lead-sm text-ink-2 md:text-web-lead-md">
            {web('lead')}
          </p>
        </div>
      </section>
      <section aria-label={web('periodLegend')} className="pb-16">
        <div className="site-container">
          <PricingPlans
            getUrl="/get?src=pricing"
            prices={await planPrices(locale, view)}
            labels={{
              legend: web('periodLegend'),
              monthly: paywall('periods.monthly'),
              annual: paywall('periods.annual'),
              bestValue: toUpper(paywall('bestValue'), locale),
              freeTitle: web('freeTitle'),
              freePrice: formatTry(0, locale),
              freeSub: web('freeSub'),
              freeCta: web('freeCta'),
              proTitle: page('proTitle'),
              proCta: web('proCta'),
              priceUnavailable: page('priceUnavailable'),
              trialLine: trialDays === null ? null : web('trialLine', { days: trialDays }),
              regionNote: page('storeRegionNote'),
            }}
          />
        </div>
      </section>
      <section aria-label={web('tableCaption')} className="pb-16 md:pb-20">
        <div className="site-container max-w-[1080px]">
          <ComparisonTable limits={limits} />
        </div>
      </section>
      <section aria-labelledby="billing-title" className="pb-16 md:pb-24">
        <div className="site-container">
          <div className="mx-auto max-w-[760px]">
            <h2 id="billing-title" className="text-web-h2 md:text-web-h2-md">
              {page('billingTitle')}
            </h2>
            <div className="mt-8">
              <FaqList items={faq} />
            </div>
          </div>
        </div>
      </section>
      <DownloadBand
        locale={locale}
        store={config.store}
        siteUrl={config.siteUrl}
        placement="pricing"
        qrPlacement="qr_pricing"
        title={page('downloadTitle')}
      />
    </main>
  );
}
