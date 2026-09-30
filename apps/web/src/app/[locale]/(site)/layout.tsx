import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/layout/SiteFooter.tsx';
import { SiteHeader } from '@/components/layout/SiteHeader.tsx';
import { SkipLink } from '@/components/layout/SkipLink.tsx';
import { SITE_CONTENT_DATE } from '@/content/meta.ts';
import { siteConfig } from '@/lib/site-config.ts';

/** Chrome of the localized site pages: skip link, header, page `<main>`, footer. */
export default async function SiteLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.common');
  const config = siteConfig();
  return (
    <>
      <SkipLink label={t('skipToContent')} />
      <SiteHeader />
      {children}
      <SiteFooter
        companyName={config.company.displayName}
        year={Number(SITE_CONTENT_DATE.slice(0, 4))}
      />
    </>
  );
}
