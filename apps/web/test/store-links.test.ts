import { describe, expect, it } from 'vitest';
import {
  androidIntentUrl,
  appDeepLink,
  appStoreUrl,
  buildStoreLinks,
  devicePlatform,
  playStoreUrl,
  resolveStoreTarget,
  smartLink,
  type StoreConfig,
} from '../src/lib/store-links.ts';

const CONFIG: StoreConfig = {
  iosAppStoreId: '1234567890',
  appStoreProviderToken: '118000',
  androidPackage: 'com.dijitalasistan.app',
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36';

describe('store links (Part 5 §0.7)', () => {
  it('builds App Store URLs per storefront with campaign tokens', () => {
    expect(appStoreUrl(CONFIG, 'tr', 'hero')).toBe(
      'https://apps.apple.com/tr/app/id1234567890?pt=118000&ct=hero&mt=8',
    );
    expect(appStoreUrl(CONFIG, 'en', 'final')).toBe(
      'https://apps.apple.com/us/app/id1234567890?pt=118000&ct=final&mt=8',
    );
    expect(appStoreUrl({ ...CONFIG, appStoreProviderToken: undefined }, 'tr', 'hero')).toBe(
      'https://apps.apple.com/tr/app/id1234567890?mt=8',
    );
  });

  it('hides the App Store without an app ID instead of guessing one', () => {
    expect(appStoreUrl({ ...CONFIG, iosAppStoreId: undefined }, 'tr', 'hero')).toBeNull();
  });

  it('carries campaign or referral data in the Play install referrer', () => {
    const campaign = new URL(
      playStoreUrl(CONFIG, 'tr', { kind: 'campaign', placement: 'pricing' }),
    );
    expect(campaign.searchParams.get('id')).toBe('com.dijitalasistan.app');
    expect(campaign.searchParams.get('hl')).toBe('tr');
    expect(campaign.searchParams.get('referrer')).toBe('utm_source=web&utm_medium=pricing');
    const referral = buildStoreLinks(CONFIG, 'en', 'referral', '7K2M4QX');
    expect(referral.play).toContain('referrer=code%3D7K2M4QX');
    expect(referral.appStore).toContain('ct=referral');
  });

  it('routes /get by user agent', () => {
    expect(resolveStoreTarget(IPHONE, true, 'qr_hero', CONFIG)).toEqual({
      target: 'app_store',
      location: 'https://apps.apple.com/tr/app/id1234567890?pt=118000&ct=qr_hero&mt=8',
      src: 'qr_hero',
    });
    expect(resolveStoreTarget(ANDROID, false, 'header', CONFIG).target).toBe('play_store');
    expect(resolveStoreTarget('Mozilla/5.0 (X11; Linux x86_64)', true, 'header', CONFIG)).toEqual({
      target: 'web',
      location: '/#download',
      src: 'header',
    });
    expect(resolveStoreTarget(null, false, '<script>', CONFIG)).toEqual({
      target: 'web',
      location: '/en#download',
      src: 'web',
    });
    // An iPhone without a configured App Store ID lands on the download band.
    expect(
      resolveStoreTarget(IPHONE, true, 'hero', { ...CONFIG, iosAppStoreId: undefined }).target,
    ).toBe('web');
  });

  it('detects platforms conservatively', () => {
    expect(devicePlatform(IPHONE)).toBe('ios');
    expect(devicePlatform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('ios');
    expect(devicePlatform(ANDROID)).toBe('android');
    expect(devicePlatform('Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)')).toBe('other');
    expect(devicePlatform(null)).toBe('other');
  });

  it('builds deep links and Android intents', () => {
    expect(smartLink('https://dijitalasistan.app', 'qr_final')).toBe(
      'https://dijitalasistan.app/get?src=qr_final',
    );
    expect(appDeepLink('/integrations/callback', new URLSearchParams({ provider: 'google' }))).toBe(
      'dijitalasistan://integrations/callback?provider=google',
    );
    expect(appDeepLink('today', null)).toBe('dijitalasistan://today');
    expect(
      androidIntentUrl(
        'settings/referral',
        new URLSearchParams({ code: 'ABC' }),
        'com.dijitalasistan.app',
        'https://play.google.com/x?a=1',
      ),
    ).toBe(
      'intent://settings/referral?code=ABC#Intent;scheme=dijitalasistan;package=com.dijitalasistan.app;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fx%3Fa%3D1;end',
    );
  });
});
