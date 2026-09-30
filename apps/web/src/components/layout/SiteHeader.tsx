import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { LogoLockup } from './Logo.tsx';
import { MobileMenu, type MenuItem } from './MobileMenu.tsx';

/**
 * Sticky site header (W-CMP-02): logo, section navigation, locale switch and the "Ücretsiz Başla"
 * CTA (`/get?src=header`, which routes phones to their store). There is no sign-in link: the
 * website has no user accounts (C-24).
 */
export async function SiteHeader(): Promise<ReactNode> {
  const t = await getTranslations('webPages');
  const items: MenuItem[] = [
    {
      href: '/#how-it-works',
      label: t('nav.howItWorks'),
      target: 'how_it_works',
      alsoInHeaderFromMd: false,
    },
    { href: '/#features', label: t('nav.features'), target: 'features', alsoInHeaderFromMd: true },
    { href: '/#security', label: t('nav.security'), target: 'security', alsoInHeaderFromMd: true },
    { href: '/pricing', label: t('nav.pricing'), target: 'pricing', alsoInHeaderFromMd: true },
    { href: '/#faq', label: t('nav.faq'), target: 'faq', alsoInHeaderFromMd: false },
  ];
  const cta = { href: '/get?src=header', label: t('nav.getStarted') };

  return (
    <header className="sticky top-0 z-(--da-z-sticky) border-b border-border-hairline bg-overlay-glass-card backdrop-blur-md no-print">
      <div className="site-container flex h-16 items-center gap-4">
        <Link
          href="/"
          aria-label={t('common.logoHome')}
          className="inline-flex min-h-11 items-center rounded-button"
        >
          <LogoLockup />
        </Link>
        <nav aria-label={t('common.mainNav')} className="ml-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {items.map((item) => (
              <li
                key={item.target}
                className={item.alsoInHeaderFromMd ? undefined : 'hidden xl:block'}
              >
                <Link
                  href={item.href}
                  data-ev="web_nav_click"
                  data-target={item.target}
                  className="inline-flex min-h-11 items-center rounded-button px-3 text-label text-ink-2 hover:bg-surface-sunken hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <LocaleSwitch
            label={t('common.switchLocale')}
            ariaLabel={t('common.switchLocaleLabel')}
            className="hidden min-h-11 items-center rounded-button px-3 text-label text-ink-2 hover:bg-surface-sunken md:inline-flex"
          />
          <a
            href={cta.href}
            data-ev="web_cta_click"
            data-cta="get_started"
            data-placement="header"
            className="hidden min-h-11 items-center rounded-button bg-primary px-4 text-label text-text-on-primary hover:bg-brand-primary-pressed md:inline-flex"
          >
            {cta.label}
          </a>
          <MobileMenu
            items={items}
            cta={cta}
            labels={{
              menu: t('common.menu'),
              close: t('common.closeMenu'),
              nav: t('common.mainNav'),
              localeLabel: t('common.otherLocaleName'),
              localeAria: t('common.switchLocaleLabel'),
            }}
          />
        </div>
      </div>
    </header>
  );
}
