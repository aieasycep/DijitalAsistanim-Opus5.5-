import { NextResponse, type NextRequest } from 'next/server';
import { clientEnv } from '@/env/client.ts';
import { serverEnv } from '@/env/server.ts';
import { resolveLinkLocale } from '@/i18n/locales.ts';
import { PUBLIC_API_PATH } from '@/lib/site.ts';
import { resolveStoreTarget } from '@/lib/store-links.ts';

/**
 * W-GET-01 · `/get?src=…`: one URL for the header CTA and every QR code. iPhone → App Store,
 * Android → Google Play, anything else → the download band. No client-side sniffing and no
 * identifiers; the redirect is counted as a content-free aggregate event.
 */
export function GET(request: NextRequest): NextResponse {
  const env = serverEnv();
  const acceptLanguage = request.headers.get('accept-language');
  const prefersTurkish = resolveLinkLocale(null, acceptLanguage) === 'tr';
  const { target, location, src } = resolveStoreTarget(
    request.headers.get('user-agent'),
    prefersTurkish,
    request.nextUrl.searchParams.get('src'),
    {
      iosAppStoreId: env.IOS_APP_STORE_ID,
      appStoreProviderToken: env.APP_STORE_PROVIDER_TOKEN,
      androidPackage: env.ANDROID_PACKAGE,
    },
  );

  const base = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (clientEnv.NEXT_PUBLIC_ANALYTICS_ENABLED && base !== undefined) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined) {
      headers.apikey = clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    }
    // Fire-and-forget with a short timeout: the redirect never waits on analytics.
    void fetch(`${base}${PUBLIC_API_PATH}/web-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'web_get_redirect',
        page: 'home',
        locale: prefersTurkish ? 'tr' : 'en',
        device_class: target === 'web' ? 'desktop' : 'mobile',
        theme: 'light',
        props: { target, src },
      }),
      signal: AbortSignal.timeout(300),
    }).catch(() => undefined);
  }

  // Store URLs are absolute; the download band is a same-site relative Location (RFC 9110).
  return new NextResponse(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'private, no-store',
      vary: 'User-Agent, Accept-Language',
      'x-robots-tag': 'noindex',
    },
  });
}
