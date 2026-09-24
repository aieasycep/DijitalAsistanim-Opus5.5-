import type { Locale } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { smartLink, type StoreConfig } from '@/lib/store-links.ts';
import { QrDownload } from '../download/QrDownload.tsx';
import { StoreBadges } from '../download/StoreBadges.tsx';
import {
  IconAutoAwesome,
  IconEvent,
  IconHistory,
  IconMarkEmailRead,
  IconPriorityHigh,
  IconSchedule,
  IconVerifiedUser,
} from '../icons/generated/index.ts';
import { DevNotice } from '../ui/DevNotice.tsx';
import { Kicker } from '../ui/Section.tsx';

const BRIEFING_SECTIONS = [
  { key: 'priorities', Icon: IconPriorityHigh },
  { key: 'schedule', Icon: IconEvent },
  { key: 'awaiting_me', Icon: IconMarkEmailRead },
  { key: 'awaiting_them', Icon: IconHistory },
  { key: 'deadlines', Icon: IconSchedule },
  { key: 'life', Icon: IconVerifiedUser },
] as const;

/**
 * S1 · Hero (W-HOME-01): the M§73 headline and supporting line verbatim, store buttons, QR on
 * desktop, trust line. The visual is a brand panel listing the six briefing sections by their
 * app names (`briefing.sections.*`) — product structure, not a drawn screenshot.
 */
export async function Hero({
  locale,
  store,
  siteUrl,
  devMissing,
  production,
}: {
  locale: Locale;
  store: StoreConfig;
  siteUrl: string;
  devMissing: readonly string[];
  production: boolean;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages');
  const sections = await getTranslations('briefing.sections');
  const storeMissing = store.iosAppStoreId === undefined ? ['IOS_APP_STORE_ID'] : [];
  return (
    <section
      id="top"
      data-section="hero"
      aria-labelledby="hero-title"
      className="pt-12 pb-16 md:pt-16 md:pb-20 xl:pt-20 xl:pb-28 [background:var(--da-gradient-onboarding-tint)]"
    >
      <div className="site-container grid gap-12 md:grid-cols-12 md:items-center">
        <div className="md:col-span-7 xl:col-span-6">
          <div className="motion-hero">
            <Kicker ai>{t('home.hero.kicker')}</Kicker>
          </div>
          <h1
            id="hero-title"
            className="motion-hero motion-hero-1 mt-4 text-web-hero-sm text-balance text-ink md:text-web-hero-md xl:text-web-hero-lg"
          >
            {t('home.hero.title')}
          </h1>
          <p className="motion-hero motion-hero-2 mt-5 max-w-xl text-web-lead-sm text-ink-2 md:text-web-lead-md xl:text-web-lead">
            {t('home.hero.lead')}
          </p>
          <div className="mt-8 flex flex-col gap-5 xl:flex-row xl:items-center">
            <StoreBadges locale={locale} placement="hero" store={store} />
            <QrDownload
              url={smartLink(siteUrl, 'qr_hero')}
              placement="qr_hero"
              labels={{
                title: t('download.qrTitle'),
                sub: t('download.qrSub'),
                alt: t('download.qrAlt'),
                button: t('download.qrButton'),
                close: t('download.close'),
              }}
            />
          </div>
          <p className="mt-6 max-w-xl text-secondary text-ink-2">{t('home.hero.trust')}</p>
          <DevNotice
            keys={[...new Set([...storeMissing, ...devMissing])]}
            production={production}
          />
        </div>
        <div className="md:col-span-5 xl:col-span-5 xl:col-start-8">
          <div className="band-dark mx-auto max-w-[440px] rounded-hero p-6 text-text-on-gradient shadow-float md:p-8 [background:var(--da-gradient-dawn)]">
            <p className="flex items-center gap-2 text-web-kicker text-text-on-gradient-secondary">
              <IconAutoAwesome filled size={16} />
              {t('home.hero.panelKicker')}
            </p>
            <p className="mt-3 text-title-lg">{t('home.hero.panelTitle')}</p>
            <ul className="mt-6 flex flex-col gap-2" aria-label={t('home.briefing.listLabel')}>
              {BRIEFING_SECTIONS.map(({ key, Icon }) => (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-card-sm bg-on-gradient-fill10 px-4 py-3 text-row-title"
                >
                  <Icon size={20} className="text-text-count-on-dawn" />
                  {sections(key)}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-secondary text-text-on-gradient-secondary">
              {t('home.hero.panelFoot')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
