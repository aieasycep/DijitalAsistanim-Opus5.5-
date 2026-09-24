import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { LogoLockup } from '../layout/Logo.tsx';
import { SkipLink } from '../layout/SkipLink.tsx';

/**
 * Minimal chrome of the locale-neutral link targets (`/r/*`, `/oauth/done`, `/app/*`; W-REF-01,
 * W-OAUTH-01, W-APP-01): logo, one centred column, a short footer with the legal links and
 * `?lang=` language links (these URLs stay unprefixed because they are universal links).
 */
export async function LinkPageShell({
  page,
  langHrefs,
  maxWidth = 'max-w-[560px]',
  children,
}: {
  page: 'referral' | 'oauth_done' | 'app_link';
  langHrefs: { readonly tr: string; readonly en: string };
  maxWidth?: string;
  children: ReactNode;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages');
  const linkClass =
    'inline-flex min-h-11 items-center text-secondary text-ink-2 hover:text-ink hover:underline underline-offset-4';
  return (
    <>
      <SkipLink label={t('common.skipToContent')} />
      <header className="site-container flex h-16 items-center">
        <Link href="/" aria-label={t('common.logoHome')} className="rounded-button py-1">
          <LogoLockup />
        </Link>
      </header>
      <main
        id="main"
        tabIndex={-1}
        data-page={page}
        className="site-container pb-16 focus-visible:outline-none"
      >
        <div className={`mx-auto ${maxWidth} pt-6 md:pt-12`}>{children}</div>
      </main>
      <footer className="border-t border-border-hairline bg-surface">
        <nav
          aria-label={t('common.footerNav')}
          className="site-container flex flex-wrap items-center gap-x-5 py-4"
        >
          <Link href="/privacy" className={linkClass}>
            {t('links.footerPrivacy')}
          </Link>
          <Link href="/terms" className={linkClass}>
            {t('links.footerTerms')}
          </Link>
          <Link href="/support" className={linkClass}>
            {t('links.footerSupport')}
          </Link>
          <span className="ml-auto flex gap-4">
            <a href={langHrefs.tr} hrefLang="tr" lang="tr" className={linkClass}>
              {t('links.languageTr')}
            </a>
            <a href={langHrefs.en} hrefLang="en" lang="en" className={linkClass}>
              {t('links.languageEn')}
            </a>
          </span>
        </nav>
      </footer>
    </>
  );
}

/** `path?…&lang=xx`, keeping only the already-validated query. */
export function withLang(path: string, query: URLSearchParams | null, lang: 'tr' | 'en'): string {
  const params = new URLSearchParams(query ?? undefined);
  params.set('lang', lang);
  return `${path}?${params.toString()}`;
}
