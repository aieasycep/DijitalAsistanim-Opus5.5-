import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/locales.ts';
import { IconSearch } from '../icons/generated/index.ts';

/** W-ERR-01 body: message and a way home. */
export async function NotFoundContent({
  locale,
  homeHref,
}: {
  locale: Locale;
  homeHref: string;
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'webPages.errors.notFound' });
  return (
    <main
      id="main"
      tabIndex={-1}
      data-page="not_found"
      className="site-container py-20 focus-visible:outline-none md:py-28"
    >
      <div className="mx-auto max-w-[560px] text-center">
        <span
          aria-hidden="true"
          className="inline-flex size-14 items-center justify-center rounded-card-sm bg-surface-sunken text-icon-default"
        >
          <IconSearch size={28} />
        </span>
        <h1 className="mt-6 text-web-h2 text-balance md:text-web-h2-md">{t('title')}</h1>
        <p className="mt-3 text-body text-ink-2">{t('body')}</p>
        <a
          href={homeHref}
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-6 text-label-lg text-text-on-primary hover:bg-brand-primary-pressed"
        >
          {t('home')}
        </a>
      </div>
    </main>
  );
}
