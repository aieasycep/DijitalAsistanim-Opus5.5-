import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { DeletionFlow } from '@/components/forms/DeletionFlow.tsx';
import { IconDelete } from '@/components/icons/generated/index.ts';
import { ScopeTable } from '@/components/legal/ScopeTable.tsx';
import { Kicker } from '@/components/ui/Section.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadWebMessages } from '@/i18n/messages.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { EXTERNAL_LINKS } from '@/lib/site.ts';

/** Rendered per request: the page accepts personal data, so it carries a nonce CSP (§0.12). */
export const instant = false;

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.deletion' });
  return pageMetadata({
    locale,
    path: '/data-deletion',
    title: t('title'),
    description: t('description'),
    indexable: siteConfig().indexable,
  });
}

const linkClass = 'text-text-link underline underline-offset-4';

/**
 * W-DEL-01 · account deletion without the app (Play account-deletion policy; C-24): in-app steps
 * first, then the email-verified web request (PUB-02 → PUB-03), the exact scope, what else to do,
 * timelines and what may be kept. History-only deletion needs the signed-in app.
 */
export default async function DataDeletionPage({ params }: Props): Promise<ReactNode> {
  await connection();
  const { locale } = await params;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const config = siteConfig();
  const t = await getTranslations('webPages.deletion');
  const company = config.company;

  const m = loadWebMessages(locale);
  const clientMessages = {
    web: { deletion: { statuses: m.web.deletion.statuses } },
    webPages: { common: m.webPages.common, deletion: m.webPages.deletion },
  };
  const section = 'mt-14';
  const h2 = 'text-web-h2 focus-visible:outline-none md:text-web-h2-md';

  return (
    <main id="main" tabIndex={-1} data-page="data_deletion" className="focus-visible:outline-none">
      <section
        aria-labelledby="deletion-title"
        className="pt-12 pb-10 md:pt-16 [background:var(--da-gradient-onboarding-tint)]"
      >
        <div className="site-container">
          <div className="max-w-3xl">
            <Kicker>{t('kicker')}</Kicker>
            <h1
              id="deletion-title"
              className="mt-4 text-web-hero-sm text-balance md:text-web-hero-md"
            >
              {t('title')}
            </h1>
            <p className="mt-4 text-web-lead-sm text-ink-2 md:text-web-lead-md">{t('lead')}</p>
          </div>
        </div>
      </section>

      <div className="site-container pb-16 md:pb-24">
        <div className="mx-auto max-w-[760px]">
          <section id="uygulamadan" aria-labelledby="uygulamadan-h" className="mt-10">
            <h2 id="uygulamadan-h" tabIndex={-1} className={h2}>
              {t('inApp.title')}
            </h2>
            <ol className="mt-5 flex flex-col gap-3">
              {(['open', 'profile', 'privacy', 'confirm'] as const).map((key, index) => (
                <li key={key} className="flex items-start gap-3 text-body">
                  <span
                    aria-hidden="true"
                    className="tabular inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-label"
                  >
                    {index + 1}
                  </span>
                  {t(`inApp.steps.${key}`)}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-secondary text-ink-2">{t('inApp.historyOnly')}</p>
          </section>

          <section id="web-talebi" aria-labelledby="web-talebi-h" className={section}>
            <h2 id="web-talebi-h" tabIndex={-1} className={`${h2} flex items-center gap-3`}>
              <IconDelete size={28} className="text-tone-critical-icon" />
              {t('web.title')}
            </h2>
            <noscript>
              <p className="mt-4 rounded-card-sm bg-tone-warning-soft px-3 py-2 text-secondary text-tone-warning-text">
                {t('flow.noScript')}
              </p>
            </noscript>
            <div className="mt-6">
              <NextIntlClientProvider messages={clientMessages}>
                <DeletionFlow turnstileSiteKey={config.turnstileSiteKey} nonce={nonce} />
              </NextIntlClientProvider>
            </div>
          </section>

          <section id="neler-silinir" aria-labelledby="neler-silinir-h" className={section}>
            <h2 id="neler-silinir-h" tabIndex={-1} className={h2}>
              {t('scope.title')}
            </h2>
            <ScopeTable />
          </section>

          <section id="ayrica" aria-labelledby="ayrica-h" className={section}>
            <h2 id="ayrica-h" tabIndex={-1} className={h2}>
              {t('also.title')}
            </h2>
            <ul className="mt-5 flex list-disc flex-col gap-3 pl-5 text-body">
              <li>
                {t('also.subscription')}{' '}
                <a href={EXTERNAL_LINKS.appStoreSubscriptions} className={linkClass}>
                  {t('also.appStore')}
                </a>{' '}
                ·{' '}
                <a href={EXTERNAL_LINKS.playSubscriptions} className={linkClass}>
                  {t('also.play')}
                </a>
              </li>
              <li>
                {t('also.microsoft')}{' '}
                <a href={EXTERNAL_LINKS.microsoftPersonalConsent} className={linkClass}>
                  {t('also.microsoftPersonal')}
                </a>{' '}
                ·{' '}
                <a href={EXTERNAL_LINKS.microsoftWorkApps} className={linkClass}>
                  {t('also.microsoftWork')}
                </a>
              </li>
              <li>{t('also.device')}</li>
            </ul>
          </section>

          <section id="sure" aria-labelledby="sure-h" className={section}>
            <h2 id="sure-h" tabIndex={-1} className={h2}>
              {t('duration.title')}
            </h2>
            <p className="mt-4 text-body">{t('duration.body')}</p>
            <p className="mt-3 text-body">
              {config.legal.backupDays === undefined
                ? t('duration.backupsUnset')
                : t('duration.backups', { days: config.legal.backupDays })}
            </p>
          </section>

          <section id="saklananlar" aria-labelledby="saklananlar-h" className={section}>
            <h2 id="saklananlar-h" tabIndex={-1} className={h2}>
              {t('kept.title')}
            </h2>
            <p className="mt-4 text-body">{t('kept.body')}</p>
          </section>

          <section id="yardim" aria-labelledby="yardim-h" className={section}>
            <h2 id="yardim-h" tabIndex={-1} className={h2}>
              {t('help.title')}
            </h2>
            <p className="mt-4 text-body">{t('help.relay')}</p>
            <p className="mt-3 text-body">
              {t.rich('help.noAccess', {
                support: (chunks) => (
                  <Link
                    href={{ pathname: '/support', query: { category: 'privacy' }, hash: 'contact' }}
                    className={linkClass}
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            {company.kepAddress === undefined ? null : (
              <p className="mt-2 text-secondary text-ink-2">
                {t('help.kep', { kep: company.kepAddress })}
              </p>
            )}
            {company.address === undefined ? null : (
              <p className="mt-1 text-secondary text-ink-2">
                {t('help.postal', { address: company.address })}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
