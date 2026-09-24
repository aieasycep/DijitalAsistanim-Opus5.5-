import type { Locale } from '@da/i18n';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { LinkPageShell, withLang } from '@/components/links/LinkPageShell.tsx';
import { OAuthDoneView } from '@/components/links/OAuthDoneView.tsx';
import { oauthDoneModel } from '@/lib/oauth-done.ts';
import { linkPageMetadata } from '@/lib/seo.ts';
import { siteConfig } from '@/lib/site-config.ts';
import { devicePlatform } from '@/lib/store-links.ts';

/** Reads the query and user agent per request; nonce-protected, never cached. */
export const instant = false;

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const model = oauthDoneModel(await searchParams);
  const t = await getTranslations({ locale, namespace: 'webPages.seo.oauthDone' });
  const config = siteConfig();
  const query = model.callbackQuery.toString();
  return linkPageMetadata({
    title: t('title'),
    description: t('description'),
    iosAppStoreId: config.store.iosAppStoreId,
    appArgument: `${config.siteUrl}/oauth/done${query === '' ? '' : `?${query}`}`,
  });
}

/** W-OAUTH-01 · universal-link fallback after a provider consent screen. */
export default async function OAuthDonePage({ params, searchParams }: Props): Promise<ReactNode> {
  await connection();
  const { locale } = await params;
  const model = oauthDoneModel(await searchParams);
  const platform = devicePlatform((await headers()).get('user-agent'));
  const config = siteConfig();
  return (
    <LinkPageShell
      page="oauth_done"
      maxWidth="max-w-[480px]"
      langHrefs={{
        tr: withLang('/oauth/done', model.callbackQuery, 'tr'),
        en: withLang('/oauth/done', model.callbackQuery, 'en'),
      }}
    >
      <OAuthDoneView model={model} platform={platform} locale={locale} store={config.store} />
    </LinkPageShell>
  );
}
