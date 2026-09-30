import { normalizeReferralCode } from '@da/domain/referrals/code';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { parseClientEnv, parseServerEnv } from './env/schema.ts';
import { resolveLinkLocale } from './i18n/locales.ts';
import { routing } from './i18n/routing.ts';
import { buildCsp, isLinkRoute, isNonceRoute, isNoReferrerRoute, originOf } from './lib/csp.ts';

/**
 * Next 16 proxy (ADR-52; SCREEN_AND_FLOW_MAP Part 5 §0.2, §0.12):
 * - localized pages: next-intl routing (`/` Turkish, `/en/…` English; no cookie, no detection);
 * - locale-neutral link targets (`/r/*`, `/oauth/done`, `/app/*`): internally rewritten to
 *   `/{locale}/…`, the locale chosen by `?lang` → `Accept-Language` → Turkish, so universal
 *   links keep their unprefixed URLs;
 * - Content-Security-Policy on every page; a fresh nonce for the per-request routes;
 * - `Referrer-Policy: no-referrer` on deletion and link routes, `noindex` on link routes.
 */

const intl = createMiddleware(routing);

const clientEnv = parseClientEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_ANALYTICS_ENABLED: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
const indexable = parseServerEnv(process.env).indexable;
const apiOrigin = originOf(clientEnv.NEXT_PUBLIC_SUPABASE_URL);
const upgradeInsecure = clientEnv.NEXT_PUBLIC_SITE_URL.startsWith('https://');
const development = process.env.NODE_ENV === 'development';

const LOCALE_PREFIX = /^\/(en|tr)(?=\/|$)/;

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** `/r/7k2m-4qx` → 308 `/r/7K2M4QX` (W-REF-01), before any byte of the page is streamed. */
function canonicalReferralRedirect(
  request: NextRequest,
  bare: string,
  prefix: string,
): NextResponse | null {
  const match = /^\/r\/([^/]+)$/.exec(bare);
  if (match?.[1] === undefined) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const normalized = normalizeReferralCode(raw);
  if (normalized === '' || normalized === raw) return null;
  const target = request.nextUrl.clone();
  target.pathname = `${prefix}/r/${encodeURIComponent(normalized)}`;
  return NextResponse.redirect(target, 308);
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, searchParams } = request.nextUrl;
  const prefix = LOCALE_PREFIX.exec(pathname);
  const bare = prefix === null ? pathname : pathname.slice(prefix[0].length) || '/';
  const redirect = canonicalReferralRedirect(request, bare, prefix?.[0] ?? '');
  if (redirect !== null) return redirect;

  const nonce = isNonceRoute(bare) ? newNonce() : undefined;
  const csp = buildCsp({
    ...(nonce === undefined ? {} : { nonce }),
    apiOrigin,
    turnstile: clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== undefined,
    development,
    upgradeInsecure,
  });
  if (nonce !== undefined) {
    // Next.js reads the nonce from the request's CSP header and applies it to its scripts.
    request.headers.set('content-security-policy', csp);
    request.headers.set('x-nonce', nonce);
  }

  let response: NextResponse;
  if (prefix === null && isLinkRoute(pathname)) {
    const locale = resolveLinkLocale(
      searchParams.get('lang'),
      request.headers.get('accept-language'),
    );
    const target = request.nextUrl.clone();
    target.pathname = `/${locale}${pathname}`;
    response = NextResponse.rewrite(target, { request: { headers: request.headers } });
  } else {
    response = intl(request);
  }

  response.headers.set('content-security-policy', csp);
  if (isNoReferrerRoute(bare)) response.headers.set('referrer-policy', 'no-referrer');
  if (isLinkRoute(bare) || !indexable) response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}

export const config = {
  // Everything except Next internals, route handlers (`/get`, `/well-known/*`), metadata files
  // (OG images, icons, sitemap, robots, manifest) and static files with an extension.
  matcher: [
    '/((?!_next/|_vercel/|get|well-known/|\\.well-known/|.*opengraph-image|.*twitter-image|icon|apple-icon|.*\\..*).*)',
  ],
};
