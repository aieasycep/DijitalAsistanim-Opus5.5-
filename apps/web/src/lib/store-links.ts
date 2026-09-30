import type { Locale } from '@da/i18n';
import { APP_SCHEME } from './site.ts';

/**
 * Every store and smart link on the site (SCREEN_AND_FLOW_MAP Part 5 §0.7, registry R-28).
 * There are no store URLs anywhere else. Campaign values are aggregate tokens; they never carry a
 * user identifier.
 */

export const PLACEMENTS = [
  'header',
  'hero',
  'pricing',
  'final',
  'menu',
  'referral',
  'app_link',
  'oauth_done',
  'qr_hero',
  'qr_final',
  'qr_pricing',
] as const;
export type Placement = (typeof PLACEMENTS)[number];

export function isPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}

export interface StoreConfig {
  /** Numeric App Store app ID (`IOS_APP_STORE_ID`); the App Store is hidden when unset. */
  readonly iosAppStoreId: string | undefined;
  /** App Store Connect campaign provider token (`APP_STORE_PROVIDER_TOKEN`). */
  readonly appStoreProviderToken: string | undefined;
  /** Android application ID (`ANDROID_PACKAGE`). */
  readonly androidPackage: string;
}

export type PlayReferrer =
  | { readonly kind: 'campaign'; readonly placement: Placement }
  | { readonly kind: 'referral'; readonly code: string };

export function appStoreUrl(
  config: StoreConfig,
  locale: Locale,
  placement: Placement,
): string | null {
  if (config.iosAppStoreId === undefined) return null;
  const storefront = locale === 'tr' ? 'tr' : 'us';
  const url = new URL(`https://apps.apple.com/${storefront}/app/id${config.iosAppStoreId}`);
  if (config.appStoreProviderToken !== undefined) {
    url.searchParams.set('pt', config.appStoreProviderToken);
    url.searchParams.set('ct', placement);
  }
  url.searchParams.set('mt', '8');
  return url.toString();
}

export function playReferrerValue(referrer: PlayReferrer): string {
  return referrer.kind === 'referral'
    ? `code=${referrer.code}`
    : `utm_source=web&utm_medium=${referrer.placement}`;
}

export function playStoreUrl(config: StoreConfig, locale: Locale, referrer: PlayReferrer): string {
  const url = new URL('https://play.google.com/store/apps/details');
  url.searchParams.set('id', config.androidPackage);
  url.searchParams.set('hl', locale);
  url.searchParams.set('referrer', playReferrerValue(referrer));
  return url.toString();
}

export interface StoreLinks {
  readonly appStore: string | null;
  readonly play: string;
}

export function buildStoreLinks(
  config: StoreConfig,
  locale: Locale,
  placement: Placement,
  referralCode?: string,
): StoreLinks {
  return {
    appStore: appStoreUrl(config, locale, placement),
    play: playStoreUrl(
      config,
      locale,
      referralCode === undefined
        ? { kind: 'campaign', placement }
        : { kind: 'referral', code: referralCode },
    ),
  };
}

/** The UA-routed smart link used by the header CTA and QR codes (`/get?src=…`). */
export function smartLink(siteUrl: string, src: Placement): string {
  return `${siteUrl}/get?src=${src}`;
}

export type StoreTarget = 'app_store' | 'play_store' | 'web';

export function devicePlatform(userAgent: string | null): 'ios' | 'android' | 'other' {
  if (userAgent === null) return 'other';
  if (/Windows Phone/i.test(userAgent)) return 'other';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** `/get` routing (Part 5 W-GET-01): iOS → App Store, Android → Play, else the download band. */
export function resolveStoreTarget(
  userAgent: string | null,
  prefersTurkish: boolean,
  rawSrc: string | null,
  config: StoreConfig,
): { target: StoreTarget; location: string; src: Placement | 'web' } {
  const src = isPlacement(rawSrc) ? rawSrc : 'web';
  const placement: Placement = src === 'web' ? 'header' : src;
  const locale: Locale = prefersTurkish ? 'tr' : 'en';
  const platform = devicePlatform(userAgent);
  if (platform === 'ios') {
    const url = appStoreUrl(config, locale, placement);
    if (url !== null) return { target: 'app_store', location: url, src };
  }
  if (platform === 'android') {
    return {
      target: 'play_store',
      location: playStoreUrl(config, locale, { kind: 'campaign', placement }),
      src,
    };
  }
  return { target: 'web', location: prefersTurkish ? '/#download' : '/en#download', src };
}

/**
 * Android "open in app" link with a Play Store fallback (Part 5 §0.7):
 * `intent://{path}?{query}#Intent;scheme=dijitalasistan;package=…;S.browser_fallback_url=…;end`.
 */
export function androidIntentUrl(
  path: string,
  query: URLSearchParams | null,
  androidPackage: string,
  fallbackUrl: string,
): string {
  const cleanPath = path.replace(/^\/+/, '');
  const search = query !== null && query.size > 0 ? `?${query.toString()}` : '';
  return `intent://${cleanPath}${search}#Intent;scheme=${APP_SCHEME};package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

/** Custom-scheme deep link (`dijitalasistan://path?query`). */
export function appDeepLink(path: string, query: URLSearchParams | null): string {
  const cleanPath = path.replace(/^\/+/, '');
  const search = query !== null && query.size > 0 ? `?${query.toString()}` : '';
  return `${APP_SCHEME}://${cleanPath}${search}`;
}
