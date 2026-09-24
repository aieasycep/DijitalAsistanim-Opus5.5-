import type { Locale } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { buildStoreLinks, type Placement, type StoreConfig } from '@/lib/store-links.ts';
import { IconDownload, IconMobile } from '../icons/generated/index.ts';
import { cx } from '../ui/cx.ts';

/**
 * Store buttons (W-CMP-07). Links come from `lib/store-links.ts`; a store whose app ID is not
 * configured is not rendered. They open in the same tab. The official badge artwork (Apple
 * Marketing Resources, Google Play badge guidelines) is a Manual external step; these buttons
 * use the store names in PRIMARY styling and never imitate the official badges.
 */
export async function StoreBadges({
  locale,
  placement,
  store,
  referralCode,
  tone = 'light',
  className,
}: {
  locale: Locale;
  placement: Placement;
  store: StoreConfig;
  referralCode?: string;
  tone?: 'light' | 'dark';
  className?: string;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.download');
  const links = buildStoreLinks(store, locale, placement, referralCode);
  const button = cx(
    'inline-flex min-h-12 w-full items-center gap-3 rounded-button px-4 py-2 text-left md:w-auto',
    tone === 'light'
      ? 'bg-inverse-bg text-inverse-text hover:opacity-90'
      : 'bg-surface text-ink hover:bg-surface-pressed',
  );
  return (
    <ul aria-label={t('badgesLabel')} className={cx('flex flex-col gap-3 md:flex-row', className)}>
      {links.appStore === null ? null : (
        <li>
          <a
            href={links.appStore}
            className={button}
            data-ev="web_cta_click"
            data-cta="app_store"
            data-placement={placement}
          >
            <IconMobile size={24} />
            <span className="flex flex-col">
              <span aria-hidden="true" className="text-meta opacity-80">
                {t('appStorePlatform')}
              </span>
              <span className="text-label-lg">{t('appStore')}</span>
            </span>
          </a>
        </li>
      )}
      <li>
        <a
          href={links.play}
          className={button}
          data-ev="web_cta_click"
          data-cta="play_store"
          data-placement={placement}
        >
          <IconDownload size={24} />
          <span className="flex flex-col">
            <span aria-hidden="true" className="text-meta opacity-80">
              {t('googlePlayPlatform')}
            </span>
            <span className="text-label-lg">{t('googlePlay')}</span>
          </span>
        </a>
      </li>
    </ul>
  );
}
