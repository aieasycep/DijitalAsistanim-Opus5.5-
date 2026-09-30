import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NotFoundContent } from '@/components/layout/NotFoundContent.tsx';
import { SiteFooter } from '@/components/layout/SiteFooter.tsx';
import { SiteHeader } from '@/components/layout/SiteHeader.tsx';
import { SkipLink } from '@/components/layout/SkipLink.tsx';
import { SITE_CONTENT_DATE } from '@/content/meta.ts';
import { isWebLocale } from '@/i18n/locales.ts';
import { siteConfig } from '@/lib/site-config.ts';

/** W-ERR-01 · unknown path inside a locale (`/nope`, `/en/nope`, `/de`): 404 with the site chrome. */
export default async function LocaleNotFound(): Promise<ReactNode> {
  const current = await getLocale();
  const locale = isWebLocale(current) ? current : 'tr';
  const t = await getTranslations({ locale, namespace: 'webPages.common' });
  return (
    <>
      <SkipLink label={t('skipToContent')} />
      <SiteHeader />
      <NotFoundContent locale={locale} homeHref={locale === 'tr' ? '/' : '/en'} />
      <SiteFooter
        companyName={siteConfig().company.displayName}
        year={Number(SITE_CONTENT_DATE.slice(0, 4))}
      />
    </>
  );
}
