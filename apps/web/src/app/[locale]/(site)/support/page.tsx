import { FAQ_CATEGORIES, type Locale } from '@da/i18n';
import { isTicketCategory } from '@/lib/ticket-category.ts';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { FaqDeepLink } from '@/components/faq/FaqDeepLink.tsx';
import { FaqList } from '@/components/faq/FaqList.tsx';
import { renderFaqItems } from '@/components/faq/faq-content.tsx';
import { SupportForm } from '@/components/forms/SupportForm.tsx';
import { IconDelete, IconSupportAgent } from '@/components/icons/generated/index.ts';
import { JsonLd } from '@/components/JsonLd.tsx';
import { Kicker } from '@/components/ui/Section.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadWebMessages } from '@/i18n/messages.ts';
import { faqPageLd } from '@/lib/json-ld.ts';
import { freeLimits } from '@/lib/pricing.ts';
import { getPlans } from '@/lib/public-api/server.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { SUPPORT_EMAIL } from '@/lib/site.ts';
import { toUpper } from '@da/i18n';

/** Rendered per request: the page accepts personal data, so it carries a nonce CSP (§0.12). */
export const instant = false;

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.support' });
  return pageMetadata({
    locale,
    path: '/support',
    title: t('title'),
    description: t('description'),
    indexable: siteConfig().indexable,
  });
}

/** W-SUP-01 · the shared FAQ catalog by category, and the contact form (PUB-01). */
export default async function SupportPage({ params, searchParams }: Props): Promise<ReactNode> {
  await connection();
  const { locale } = await params;
  const query = await searchParams;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const config = siteConfig();
  const plans = await getPlans();
  const items = await renderFaqItems({
    limits: freeLimits(plans),
    microsoftClientId: config.microsoftClientId,
  });
  const web = await getTranslations('web.support');
  const page = await getTranslations('webPages.support');
  const categories = await getTranslations('faq.categories');
  const rawCategory = typeof query.category === 'string' ? query.category : null;
  const initialCategory =
    rawCategory !== null && isTicketCategory(rawCategory) ? rawCategory : null;

  const m = loadWebMessages(locale);
  const clientMessages = {
    web: { support: { form: m.web.support.form } },
    webPages: { common: m.webPages.common, support: { form: m.webPages.support.form } },
  };

  return (
    <main id="main" tabIndex={-1} data-page="support" className="focus-visible:outline-none">
      <JsonLd data={faqPageLd(items.map((item) => ({ q: item.q, a: item.aText })))} />
      <FaqDeepLink />
      <section
        aria-labelledby="support-title"
        className="pt-12 pb-10 md:pt-16 [background:var(--da-gradient-onboarding-tint)]"
      >
        <div className="site-container">
          <Kicker>{toUpper(web('kicker'), locale)}</Kicker>
          <h1 id="support-title" className="mt-4 text-web-hero-sm text-balance md:text-web-hero-md">
            {web('title')}
          </h1>
          <p className="mt-4 max-w-2xl text-web-lead-sm text-ink-2 md:text-web-lead-md">
            {web('lead')}
          </p>
          <nav aria-label={page('categoriesLabel')} className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {FAQ_CATEGORIES.map((category) => (
                <li key={category}>
                  <a
                    href={`#kategori-${category}`}
                    className="inline-flex min-h-11 items-center rounded-pill border border-border-hairline bg-surface px-4 text-label text-ink hover:bg-surface-pressed"
                  >
                    {categories(category)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <div className="site-container py-12 md:py-16">
        <div className="mx-auto flex max-w-[760px] flex-col gap-12">
          {FAQ_CATEGORIES.map((category) => {
            const inCategory = items.filter((item) => item.category === category);
            if (inCategory.length === 0) return null;
            return (
              <section
                key={category}
                id={`kategori-${category}`}
                aria-labelledby={`kategori-${category}-h`}
              >
                <h2
                  id={`kategori-${category}-h`}
                  tabIndex={-1}
                  className="mb-4 text-web-h3 focus-visible:outline-none xl:text-web-h3-lg"
                >
                  {categories(category)}
                </h2>
                <FaqList items={inCategory} />
              </section>
            );
          })}
        </div>
      </div>

      <section
        id="contact"
        aria-labelledby="contact-title"
        className="bg-surface-sunken py-12 md:py-16"
      >
        <div className="site-container">
          <div className="mx-auto max-w-[760px]">
            <h2
              id="contact-title"
              tabIndex={-1}
              className="flex items-center gap-3 text-web-h2 focus-visible:outline-none md:text-web-h2-md"
            >
              <IconSupportAgent size={28} className="text-icon-default" />
              {web('contactTitle')}
            </h2>
            <p className="mt-3 text-body text-ink-2">
              {web('contactLead').split(SUPPORT_EMAIL)[0]}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-text-link underline underline-offset-4"
              >
                {SUPPORT_EMAIL}
              </a>
              {web('contactLead').split(SUPPORT_EMAIL)[1]}
            </p>
            <noscript>
              <p className="mt-4 rounded-card-sm bg-tone-warning-soft px-3 py-2 text-secondary text-tone-warning-text">
                {web('form.noScript')}
              </p>
            </noscript>
            <div className="mt-8">
              <NextIntlClientProvider messages={clientMessages}>
                <SupportForm
                  initialCategory={initialCategory}
                  turnstileSiteKey={config.turnstileSiteKey}
                  nonce={nonce}
                />
              </NextIntlClientProvider>
            </div>
            <p className="mt-8 flex items-start gap-3 rounded-card bg-surface p-5 text-body text-ink shadow-s1-soft">
              <IconDelete size={22} className="mt-0.5 shrink-0 text-icon-default" />
              <Link href="/data-deletion" className="text-text-link underline underline-offset-4">
                {web('deletionCallout')}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
