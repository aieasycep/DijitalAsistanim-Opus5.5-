import type { Locale } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { formatCalendarDate } from '@/lib/dates.ts';
import { formatTry, formatTryRange, type FreeLimits, type PricingView } from '@/lib/pricing.ts';
import { IconArrowForward, IconCheck } from '../icons/generated/index.ts';
import { Kicker, Section, SectionHeading } from '../ui/Section.tsx';

/**
 * S10 · Pricing teaser. Free limits come from `GET /plans`; the Pro price line appears only for
 * verified, fresh store prices. Pro is "Adil kullanım" — never unlimited (C-10).
 */
export async function PricingTeaser({
  locale,
  limits,
  pricing,
}: {
  locale: Locale;
  limits: FreeLimits | null;
  pricing: PricingView | null;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.home.pricing');
  const web = await getTranslations('web.pricing');
  const paywall = await getTranslations('paywall');
  const page = await getTranslations('webPages.pricing');

  const free = [
    limits === null
      ? t('freeItems.accountsFallback')
      : t('freeItems.accounts', { mail: limits.mail, cal: limits.cal }),
    t('freeItems.morning'),
    t('freeItems.important'),
    t('freeItems.drafts'),
    limits === null ? t('freeItems.aiFallback') : t('freeItems.ai', { n: limits.n }),
  ];
  const pro = (['accounts', 'briefings', 'meeting', 'followUp', 'audio', 'memory'] as const).map(
    (key) => t(`proItems.${key}`),
  );

  return (
    <Section id="pricing" dataSection="pricing" headingId="pricing-title">
      <Kicker>{t('kicker')}</Kicker>
      <SectionHeading id="pricing-title">{t('title')}</SectionHeading>
      <div className="mt-10 grid max-w-[1000px] gap-6 md:grid-cols-2">
        <article
          className="rounded-hero bg-surface p-6 shadow-card md:p-8"
          aria-labelledby="teaser-free"
        >
          <h3 id="teaser-free" className="text-title-lg">
            {web('freeTitle')}
          </h3>
          <p className="tabular mt-2 text-numeric-xl">{formatTry(0, locale)}</p>
          <p className="text-secondary text-ink-2">{web('freeSub')}</p>
          <ul className="mt-6 flex flex-col gap-3">
            {free.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body">
                <IconCheck size={20} className="mt-0.5 shrink-0 text-icon-ai" />
                {item}
              </li>
            ))}
          </ul>
        </article>
        <article
          className="rounded-hero border-2 border-border-selected bg-surface p-6 shadow-card md:p-8"
          aria-labelledby="teaser-pro"
        >
          <h3 id="teaser-pro" className="text-title-lg">
            {page('proTitle')}
          </h3>
          {pricing === null ? (
            <p className="mt-2 text-secondary text-ink-2">{paywall('priceInApp')}</p>
          ) : (
            <>
              <p className="tabular mt-2 text-title-xl">
                {paywall('pricePerMonth', { price: formatTryRange(pricing.monthly, locale) })}
              </p>
              <p className="text-meta text-ink-3">
                {web('storeNote', { asOf: formatCalendarDate(pricing.asOf, locale) })}
              </p>
            </>
          )}
          <ul className="mt-6 flex flex-col gap-3">
            {pro.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body">
                <IconCheck size={20} className="mt-0.5 shrink-0 text-icon-ai" />
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>
      <p className="mt-6 text-secondary text-ink-2">{t('note')}</p>
      <p className="mt-4">
        <Link
          href="/pricing"
          data-ev="web_cta_click"
          data-cta="pricing"
          data-placement="pricing"
          className="inline-flex min-h-11 items-center gap-2 text-label-lg text-text-link hover:underline underline-offset-4"
        >
          {t('link')}
          <IconArrowForward size={18} />
        </Link>
      </p>
    </Section>
  );
}
