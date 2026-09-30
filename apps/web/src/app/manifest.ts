import { color } from '@da/design-tokens';
import type { MetadataRoute } from 'next';
import { BRAND_NAME } from '@/lib/site.ts';

/** W-SYS-07 · web app manifest (the site is informational; `display: browser`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    start_url: '/',
    display: 'browser',
    background_color: color.light.bg,
    theme_color: color.light.bg,
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
