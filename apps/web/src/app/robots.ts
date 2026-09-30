import type { MetadataRoute } from 'next';
import { clientEnv } from '@/env/client.ts';
import { serverEnv } from '@/env/server.ts';

/**
 * W-SYS-04 · indexable only for a production deployment with `SITE_INDEXABLE=true` (flipped at
 * public launch, after Google verification and counsel sign-off); everything else disallows all.
 */
export default function robots(): MetadataRoute.Robots {
  if (!serverEnv().indexable) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/r/', '/oauth/', '/app/', '/get'] }],
    sitemap: `${clientEnv.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
