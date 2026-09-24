import type { MetadataRoute } from 'next';
import { LEGAL_EFFECTIVE_DATE, SITE_CONTENT_DATE } from '@/content/meta.ts';
import { clientEnv } from '@/env/client.ts';
import { INDEXABLE_PATHS, localizedPath } from '@/lib/seo.ts';

/**
 * W-SYS-03 · every public page in both locales with `hreflang` alternates. Link targets (`/r`,
 * `/oauth`, `/app`) and `/get` are never listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = clientEnv.NEXT_PUBLIC_SITE_URL;
  return INDEXABLE_PATHS.flatMap((path) => {
    const lastModified =
      path === '/privacy' || path === '/terms' ? LEGAL_EFFECTIVE_DATE : SITE_CONTENT_DATE;
    const languages = {
      tr: `${site}${localizedPath('tr', path)}`,
      en: `${site}${localizedPath('en', path)}`,
      'x-default': `${site}${localizedPath('tr', path)}`,
    };
    return (['tr', 'en'] as const).map((locale) => ({
      url: `${site}${localizedPath(locale, path)}`,
      lastModified,
      changeFrequency:
        path === '/' || path === '/pricing' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '/' ? 1 : 0.7,
      alternates: { languages },
    }));
  });
}
