'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * W-ERR-02 · render error inside a locale. No stack trace or error text is shown; the digest
 * stays in the server logs.
 */
export default function LocaleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  const t = useTranslations('webPages.errors.error');
  const locale = useLocale();
  return (
    <main
      id="main"
      tabIndex={-1}
      className="site-container py-20 focus-visible:outline-none md:py-28"
    >
      <div className="mx-auto max-w-[560px] text-center">
        <h1 className="text-web-h2 text-balance md:text-web-h2-md">{t('title')}</h1>
        <p className="mt-3 text-body text-ink-2">{t('body')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-12 items-center rounded-button bg-primary px-6 text-label-lg text-text-on-primary"
          >
            {t('retry')}
          </button>
          <a
            href={locale === 'tr' ? '/' : '/en'}
            className="inline-flex min-h-12 items-center rounded-button border border-border-strong px-6 text-label-lg"
          >
            {t('home')}
          </a>
        </div>
      </div>
    </main>
  );
}
