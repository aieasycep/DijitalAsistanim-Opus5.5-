import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { TrackView } from '@/components/analytics/TrackView.tsx';
import { QrCard } from '@/components/download/QrDownload.tsx';
import { StoreBadges } from '@/components/download/StoreBadges.tsx';
import { LinkPageShell, withLang } from '@/components/links/LinkPageShell.tsx';
import { OAuthDoneView } from '@/components/links/OAuthDoneView.tsx';
import { normalizeAppLinkPath, OAUTH_CALLBACK_PATH } from '@/lib/app-link.ts';
import { oauthDoneModel } from '@/lib/oauth-done.ts';
import { linkPageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { androidIntentUrl, buildStoreLinks, devicePlatform } from '@/lib/store-links.ts';

/** Reads the path and user agent per request; nonce-protected. */
export const instant = false;

interface Props {
  params: Promise<{ locale: Locale; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, path } = await params;
  const t = await getTranslations({ locale, namespace: 'webPages.seo.appLink' });
  const config = siteConfig();
  const appPath = normalizeAppLinkPath(path);
  return linkPageMetadata({
    title: t('title'),
    description: t('description'),
    iosAppStoreId: config.store.iosAppStoreId,
    appArgument: `${config.siteUrl}/app${appPath === '' ? '' : `/${appPath}`}`,
  });
}

/**
 * W-APP-01 · browser fallback for universal links under `/app/…`. The path is validated and never
 * displayed; query strings are dropped, except on the OAuth callback, which renders the
 * `/oauth/done` view with the same parameter allow-list.
 */
export default async function AppLinkPage({ params, searchParams }: Props): Promise<ReactNode> {
  await connection();
  const { locale, path } = await params;
  const appPath = normalizeAppLinkPath(path);
  const config = siteConfig();
  const platform = devicePlatform((await headers()).get('user-agent'));
  const t = await getTranslations('webPages');
  const selfPath = `/app${appPath === '' ? '' : `/${appPath}`}`;

  if (appPath === OAUTH_CALLBACK_PATH) {
    const model = oauthDoneModel(await searchParams);
    return (
      <LinkPageShell
        page="oauth_done"
        maxWidth="max-w-[480px]"
        langHrefs={{
          tr: withLang(selfPath, model.callbackQuery, 'tr'),
          en: withLang(selfPath, model.callbackQuery, 'en'),
        }}
      >
        <OAuthDoneView model={model} platform={platform} locale={locale} store={config.store} />
      </LinkPageShell>
    );
  }

  const links = buildStoreLinks(config.store, locale, 'app_link');
  const intent =
    platform === 'android'
      ? androidIntentUrl(appPath, null, config.store.androidPackage, links.play)
      : null;

  return (
    <LinkPageShell
      page="app_link"
      langHrefs={{ tr: withLang(selfPath, null, 'tr'), en: withLang(selfPath, null, 'en') }}
    >
      <TrackView event="web_app_link_view" page="app_link" props={{}} />
      <h1 className="text-web-h2 text-balance md:text-web-h2-md">{t('appLink.title')}</h1>
      <p className="mt-4 text-body text-ink-2">{t('appLink.body')}</p>
      <div className="mt-8 flex flex-col gap-4">
        {intent === null ? null : (
          <a
            href={intent}
            data-ev="web_cta_click"
            data-cta="open_in_app"
            data-placement="app_link"
            className="inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-5 text-label-lg text-text-on-primary"
          >
            {t('appLink.openInApp')}
          </a>
        )}
        <StoreBadges locale={locale} placement="app_link" store={config.store} />
        <QrCard
          url={`${config.siteUrl}${selfPath}`}
          alt={t('download.qrAlt')}
          title={t('appLink.qrTitle')}
          sub={t('appLink.qrSub')}
          placement="app_link"
          className="hidden md:flex"
        />
      </div>
    </LinkPageShell>
  );
}
