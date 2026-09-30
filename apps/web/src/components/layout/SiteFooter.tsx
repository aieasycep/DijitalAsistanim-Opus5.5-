import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { SUPPORT_EMAIL } from '@/lib/site.ts';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { LogoLockup } from './Logo.tsx';

/**
 * Site footer (W-CMP-03): tagline, three link columns, locale switch, trademark and
 * non-affiliation line, and "© {year} {company}". The year comes from the legal content date so
 * prerendered pages stay deterministic.
 */
export async function SiteFooter({
  companyName,
  year,
}: {
  companyName: string;
  year: number;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages');
  const linkClass =
    'inline-flex min-h-11 items-center text-secondary text-ink-2 hover:text-ink hover:underline underline-offset-4';

  return (
    <footer className="border-t border-border-hairline bg-surface no-print">
      <div className="site-container grid gap-10 py-14 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <LogoLockup />
          <p className="mt-4 max-w-72 text-body text-ink-2">{t('footer.tagline')}</p>
        </div>
        <nav aria-label={t('common.footerNav')} className="contents">
          <div>
            <h2 className="text-web-kicker text-ink-3">{t('footer.product')}</h2>
            <ul className="mt-3">
              <li>
                <Link href="/#features" className={linkClass}>
                  {t('footer.features')}
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={linkClass}>
                  {t('footer.pricing')}
                </Link>
              </li>
              <li>
                <Link href="/#faq" className={linkClass}>
                  {t('footer.faq')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-web-kicker text-ink-3">{t('footer.supportTitle')}</h2>
            <ul className="mt-3">
              <li>
                <Link href="/support" className={linkClass}>
                  {t('footer.support')}
                </Link>
              </li>
              <li>
                <Link href="/data-deletion" className={linkClass}>
                  {t('footer.deletion')}
                </Link>
              </li>
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-web-kicker text-ink-3">{t('footer.legal')}</h2>
            <ul className="mt-3">
              <li>
                <Link href="/privacy" className={linkClass}>
                  {t('footer.privacy')}
                </Link>
              </li>
              <li>
                <Link href="/privacy#veri-sorumlusu" className={linkClass}>
                  {t('footer.kvkk')}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={linkClass}>
                  {t('footer.terms')}
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="site-container border-t border-border-hairline py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex max-w-3xl flex-col gap-1 text-meta text-ink-3">
            <p>{t('footer.copyright', { year, company: companyName })}</p>
            <p>{t('footer.legalLine')}</p>
          </div>
          <p className="flex items-center gap-2 text-meta text-ink-3">
            <span>{t('footer.language')}:</span>
            <LocaleSwitch
              label={t('common.otherLocaleName')}
              ariaLabel={t('common.switchLocaleLabel')}
              className="inline-flex min-h-11 items-center text-text-link underline underline-offset-4"
            />
          </p>
        </div>
      </div>
    </footer>
  );
}
