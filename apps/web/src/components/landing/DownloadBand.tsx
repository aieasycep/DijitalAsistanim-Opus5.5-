import type { Locale } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { smartLink, type Placement, type StoreConfig } from '@/lib/store-links.ts';
import { QrDownload } from '../download/QrDownload.tsx';
import { StoreBadges } from '../download/StoreBadges.tsx';

/**
 * S12 · Final CTA (`id="download"`, dawn band): store buttons and QR. Also the pricing page's P5
 * band. `/get` sends desktop visitors here.
 */
export async function DownloadBand({
  locale,
  store,
  siteUrl,
  placement,
  qrPlacement,
  title,
}: {
  locale: Locale;
  store: StoreConfig;
  siteUrl: string;
  placement: Placement;
  qrPlacement: Placement;
  title?: string;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.download');
  return (
    <section
      id="download"
      data-section="download"
      aria-labelledby="download-title"
      className="band-dark section-pad text-text-on-gradient [background:var(--da-gradient-dawn-fullbleed)]"
    >
      <div className="site-container grid gap-10 xl:grid-cols-12 xl:items-center">
        <div className="xl:col-span-7">
          <h2
            id="download-title"
            tabIndex={-1}
            className="text-web-h2 text-balance md:text-web-h2-md xl:text-web-h2-lg"
          >
            {title ?? t('title')}
          </h2>
          <p className="mt-4 max-w-2xl text-web-lead-sm text-text-on-gradient-secondary md:text-web-lead-md">
            {t('body')}
          </p>
          <StoreBadges
            locale={locale}
            placement={placement}
            store={store}
            tone="dark"
            className="mt-8"
          />
          <p className="mt-6 text-secondary text-text-on-gradient-secondary">{t('trust')}</p>
        </div>
        <div className="xl:col-span-5 xl:justify-self-end">
          <QrDownload
            url={smartLink(siteUrl, qrPlacement)}
            placement={qrPlacement}
            labels={{
              title: t('qrTitle'),
              sub: t('qrSub'),
              alt: t('qrAlt'),
              button: t('qrButton'),
              close: t('close'),
            }}
          />
        </div>
      </div>
    </section>
  );
}
