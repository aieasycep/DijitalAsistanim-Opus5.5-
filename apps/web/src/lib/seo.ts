import type { Metadata } from 'next';
import type { Locale } from '@da/i18n';
import { OG_LOCALE } from '../i18n/locales.ts';
import { BRAND_NAME } from './site.ts';

/**
 * Per-page metadata (SCREEN_AND_FLOW_MAP Part 5 §0.9): unique title and description, canonical,
 * hreflang alternates (`tr`, `en`, `x-default` → tr), Open Graph and Twitter cards, and the
 * indexing switch. Open Graph images come from each route's `opengraph-image.tsx`.
 */

export type SitePathname = '/' | '/pricing' | '/privacy' | '/terms' | '/support' | '/data-deletion';

export const INDEXABLE_PATHS: readonly SitePathname[] = [
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/support',
  '/data-deletion',
];

/** `/pricing` → `/en/pricing`; `/` → `/en`. Turkish has no prefix. */
export function localizedPath(locale: Locale, path: string): string {
  if (locale === 'tr') return path;
  return path === '/' ? '/en' : `/en${path}`;
}

export interface PageMetadataInput {
  readonly locale: Locale;
  readonly path: SitePathname;
  readonly title: string;
  readonly description: string;
  readonly indexable: boolean;
  readonly iosAppStoreId?: string | undefined;
}

export function pageMetadata(input: PageMetadataInput): Metadata {
  const canonical = localizedPath(input.locale, input.path);
  const alternateLocale = input.locale === 'tr' ? OG_LOCALE.en : OG_LOCALE.tr;
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical,
      languages: {
        tr: localizedPath('tr', input.path),
        en: localizedPath('en', input.path),
        'x-default': localizedPath('tr', input.path),
      },
    },
    openGraph: {
      type: 'website',
      siteName: BRAND_NAME,
      locale: OG_LOCALE[input.locale],
      alternateLocale,
      url: canonical,
      title: input.title,
      description: input.description,
    },
    twitter: { card: 'summary_large_image', title: input.title, description: input.description },
    robots: input.indexable ? { index: true, follow: true } : { index: false, follow: false },
    ...(input.iosAppStoreId === undefined ? {} : { itunes: { appId: input.iosAppStoreId } }),
  };
}

/** Link-target pages (`/r`, `/oauth/done`, `/app`): never indexed, no alternates. */
export function linkPageMetadata(input: {
  readonly title: string;
  readonly description: string;
  readonly iosAppStoreId?: string | undefined;
  readonly appArgument?: string | undefined;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    robots: { index: false, follow: false },
    ...(input.iosAppStoreId === undefined
      ? {}
      : {
          itunes: {
            appId: input.iosAppStoreId,
            ...(input.appArgument === undefined ? {} : { appArgument: input.appArgument }),
          },
        }),
  };
}
