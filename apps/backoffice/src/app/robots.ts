import type { MetadataRoute } from 'next';

/** The admin panel is never indexed (BACKOFFICE_PLAN §2.8); every response also sends X-Robots-Tag. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
