// @vitest-environment happy-dom
import { referralCheckChar } from '@da/domain/referrals/code';
import { fireEvent, render, screen } from '@testing-library/react';
import type * as NextServer from 'next/server';
import { NextRequest } from 'next/server';
import type * as NextIntl from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWebMessages } from '../../src/i18n/messages.ts';
import { requestLocale } from '../stubs/next-intl-server.ts';
import { NavigationSignal, requestHeaders } from '../stubs/next-runtime.ts';
import { renderServer, textOf } from './server-render.tsx';

/*
 * Link-target pages and request handlers (SCREEN_AND_FLOW_MAP Part 5): W-REF-01 referral landing,
 * W-APP-01 universal-link fallback, W-OAUTH-01 consent return, the locale layout, W-ERR-01/02,
 * `/get` (smart store redirect) and the proxy (CSP nonce, link-route rewrites, 308 canonical
 * referral URLs). The public API is a stubbed `fetch`; the page code and copy are real.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
});

vi.mock('next-intl/server', () => import('../stubs/next-intl-server.ts'));
vi.mock('next/headers', () => import('../stubs/next-runtime.ts'));
vi.mock('next/navigation', () => import('../stubs/next-runtime.ts'));
vi.mock('next/cache', () => import('../stubs/next-runtime.ts'));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  connection: () => Promise.resolve(),
}));
vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font-var', className: 'font-class', style: {} });
  return { Geist: font, Geist_Mono: font, Lora: font };
});
vi.mock('@/i18n/navigation.ts', () => import('../stubs/i18n-navigation.tsx'));
// The locale negotiation itself belongs to next-intl; the proxy's own rules are under test.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntl>();
  const { createElement } = await import('react');
  const { requestLocale: current } = await import('../stubs/request-locale.ts');
  function Provider(props: Parameters<typeof actual.NextIntlClientProvider>[0]) {
    return createElement(actual.NextIntlClientProvider, {
      locale: current.current,
      timeZone: 'Europe/Istanbul',
      ...props,
    });
  }
  return { ...actual, NextIntlClientProvider: Provider };
});

const TR = loadWebMessages('tr');
const EN = loadWebMessages('en');
const VALID = `7K2M4Q${referralCheckChar('7K2M4Q')}`;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';

function stubReferral(status: number, data?: unknown) {
  const fetch = vi.fn((_url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(data === undefined ? { error: {} } : { data }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const referralData = (valid: boolean) => ({
  valid,
  reward_days: 14,
  apply_window_days: 7,
  store_urls: { ios: 'https://apps.apple.com/tr/app/id1', android: 'https://play.google.com/x' },
  deep_link: `dijitalasistan://settings/referral?code=${VALID}`,
  message_key: 'referral.landing',
});

beforeEach(() => {
  document.body.replaceChildren();
  requestLocale.current = 'tr';
  requestHeaders.current = new Headers({ 'user-agent': IOS_UA });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function referralPage(code: string) {
  const { default: ReferralPage } =
    await import('../../src/app/[locale]/(links)/r/[code]/page.tsx');
  return ReferralPage({ params: Promise.resolve({ locale: 'tr', code }) });
}

describe('W-REF-01 referral landing (PUB-04)', () => {
  it('a confirmed code shows the code card, the steps and the reward with the terms link', async () => {
    const fetch = stubReferral(200, referralData(true));
    const root = await renderServer(await referralPage(VALID));
    expect(root.querySelector('[data-page="referral"]')).not.toBeNull();
    expect(textOf(root.querySelector('h1'))).toBe(TR.webPages.referral.title);
    expect(textOf(root.querySelector('[data-testid="referral-code"]'))).toContain(VALID);
    expect(root.querySelector('[data-testid="referral-reward"] a')?.getAttribute('href')).toBe(
      '/terms#davet',
    );
    expect(root.querySelectorAll('ol li')).toHaveLength(3);
    expect(root.querySelector('[data-cta="open_in_app"]')).toBeNull();
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/referrals/${VALID}`);
  });

  it('offers an Android intent link on Android and never promises a reward it could not confirm', async () => {
    requestHeaders.current = new Headers({ 'user-agent': ANDROID_UA });
    stubReferral(503);
    const root = await renderServer(await referralPage(VALID));
    expect(root.querySelector('[data-testid="referral-unverified"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="referral-reward"]')).toBeNull();
    const intent = root.querySelector('[data-cta="open_in_app"]')?.getAttribute('href') ?? '';
    expect(intent.startsWith('intent://settings/referral?code=')).toBe(true);
  });

  it('an unknown or malformed code renders the invalid state without calling the API for bad input', async () => {
    stubReferral(200, referralData(false));
    const unknown = await renderServer(await referralPage(VALID));
    expect(textOf(unknown.querySelector('h1'))).toBe(TR.webPages.referral.invalidTitle);
    const fetch = stubReferral(200, referralData(true));
    const malformed = await renderServer(await referralPage('ZZZZZZZ'));
    expect(textOf(malformed.querySelector('h1'))).toBe(TR.webPages.referral.invalidTitle);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('redirects a different spelling to the canonical code (308)', async () => {
    await expect(referralPage(VALID.toLowerCase())).rejects.toMatchObject({
      kind: 'redirect',
      location: `/r/${VALID}`,
    });
  });

  it('metadata carries the canonical code as the iOS app argument only when valid', async () => {
    const { generateMetadata } = await import('../../src/app/[locale]/(links)/r/[code]/page.tsx');
    vi.stubEnv('IOS_APP_STORE_ID', '1234567890');
    const valid = await generateMetadata({
      params: Promise.resolve({ locale: 'tr', code: VALID }),
    });
    expect(valid.robots).toEqual({ index: false, follow: false });
    expect(valid.itunes).toEqual({
      appId: '1234567890',
      appArgument: `https://dijitalasistan.app/r/${VALID}`,
    });
    const invalid = await generateMetadata({
      params: Promise.resolve({ locale: 'tr', code: 'x' }),
    });
    expect(invalid.itunes).toEqual({ appId: '1234567890' });
  });
});

describe('W-APP-01 universal-link fallback', () => {
  async function appPage(path: string[] | undefined, query: Record<string, string> = {}) {
    const { default: AppLinkPage } =
      await import('../../src/app/[locale]/(links)/app/[[...path]]/page.tsx');
    return AppLinkPage({
      params: Promise.resolve({ locale: 'tr', ...(path === undefined ? {} : { path }) }),
      searchParams: Promise.resolve(query),
    });
  }

  it('shows the store badges and QR, without the path, on iOS', async () => {
    const root = await renderServer(await appPage(['mail', 'x']));
    expect(root.querySelector('[data-page="app_link"]')).not.toBeNull();
    expect(textOf(root.querySelector('h1'))).toBe(TR.webPages.appLink.title);
    expect(root.querySelector('[data-cta="open_in_app"]')).toBeNull();
    expect(textOf(root)).not.toContain('mail/x');
  });

  it('adds the Android intent on Android', async () => {
    requestHeaders.current = new Headers({ 'user-agent': ANDROID_UA });
    const root = await renderServer(await appPage(['today']));
    expect(root.querySelector('[data-cta="open_in_app"]')?.getAttribute('href')).toMatch(
      /^intent:\/\/today#Intent;scheme=dijitalasistan;/,
    );
  });

  it('renders the OAuth done view on the callback path', async () => {
    const root = await renderServer(
      await appPage(['integrations', 'callback'], { result: 'expired_state', provider: 'google' }),
    );
    expect(root.querySelector('[data-page="oauth_done"] [data-variant="expired"]')).not.toBeNull();
  });

  it('metadata points the iOS app argument at the /app path', async () => {
    const { generateMetadata } =
      await import('../../src/app/[locale]/(links)/app/[[...path]]/page.tsx');
    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'en', path: ['today'] }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe(EN.webPages.seo.appLink.title);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('W-OAUTH-01 /oauth/done', () => {
  it.each([
    [{ result: 'denied' }, 'denied'],
    [{ result: 'error', error_code: 'account_mismatch' }, 'mismatch'],
    [{ result: 'admin_consent_required', provider: 'microsoft' }, 'admin'],
  ])('%o → %s', async (query, variant) => {
    requestHeaders.current = new Headers({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' });
    const { default: OAuthDonePage } =
      await import('../../src/app/[locale]/(links)/oauth/done/page.tsx');
    const root = await renderServer(
      await OAuthDonePage({
        params: Promise.resolve({ locale: 'tr' }),
        searchParams: Promise.resolve(query),
      }),
    );
    expect(root.querySelector(`[data-variant="${variant}"]`)).not.toBeNull();
  });

  it('forwards only allow-listed parameters in the app argument', async () => {
    const { generateMetadata } = await import('../../src/app/[locale]/(links)/oauth/done/page.tsx');
    vi.stubEnv('IOS_APP_STORE_ID', '1234567890');
    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'tr' }),
      searchParams: Promise.resolve({ result: 'denied', provider: 'google', token: 'secret' }),
    });
    const argument = (meta.itunes as { appArgument?: string } | undefined)?.appArgument ?? '';
    expect(argument).toContain('/oauth/done?');
    expect(argument).toContain('result=denied');
    expect(argument).not.toContain('secret');
  });
});

describe('locale layout and error pages', () => {
  it('renders <html lang> for a supported locale and 404s otherwise', async () => {
    const mod = await import('../../src/app/[locale]/layout.tsx');
    expect(mod.generateStaticParams()).toEqual([{ locale: 'tr' }, { locale: 'en' }]);
    const html = await mod.default({
      children: <p>x</p>,
      params: Promise.resolve({ locale: 'en' }),
    });
    expect((html as { props: { lang: string } }).props.lang).toBe('en');
    await expect(
      mod.default({ children: null, params: Promise.resolve({ locale: 'de' }) }),
    ).rejects.toBeInstanceOf(NavigationSignal);
    const meta = await mod.generateMetadata({ params: Promise.resolve({ locale: 'tr' }) });
    expect(meta.metadataBase?.toString()).toBe('https://dijitalasistan.app/');
  });

  it('W-ERR-02 shows the error copy and retries through reset()', () => {
    return import('../../src/app/[locale]/error.tsx').then(({ default: LocaleError }) => {
      const reset = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={EN} timeZone="Europe/Istanbul">
          <LocaleError error={new Error('boom')} reset={reset} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        EN.webPages.errors.error.title,
      );
      expect(document.body.textContent).not.toContain('boom');
      fireEvent.click(screen.getByRole('button', { name: EN.webPages.errors.error.retry }));
      expect(reset).toHaveBeenCalledOnce();
    });
  });

  it('the global error page is bilingual and never shows the error text', async () => {
    const { default: GlobalError } = await import('../../src/app/global-error.tsx');
    const reset = vi.fn();
    const root = await renderServer(
      (<GlobalError error={new Error('secret stack')} reset={reset} />) as ReactNode,
    );
    expect(textOf(root)).toContain(TR.webPages.errors.error.title);
    expect(textOf(root)).toContain(EN.webPages.errors.error.title);
    expect(textOf(root)).not.toContain('secret stack');
  });

  it('the global 404 page links home and has its own title', async () => {
    const mod = await import('../../src/app/global-not-found.tsx');
    const root = await renderServer(mod.default());
    expect(root.querySelector('a[href="/"]')).not.toBeNull();
    expect((await mod.generateMetadata()).title).toBe(TR.webPages.seo.notFound.title);
  });
});

describe('/get smart store redirect', () => {
  it('sends iOS to the App Store, Android to Play and desktop to the download band (302, no-store)', async () => {
    vi.stubEnv('IOS_APP_STORE_ID', '1234567890');
    vi.stubEnv('ANDROID_PACKAGE', 'com.dijitalasistan.app');
    const { GET } = await import('../../src/app/get/route.ts');
    const at = (ua: string) =>
      GET(
        new NextRequest('https://dijitalasistan.app/get?src=hero', {
          headers: { 'user-agent': ua },
        }),
      );
    const ios = at(IOS_UA);
    expect(ios.status).toBe(302);
    expect(ios.headers.get('location')).toContain('apps.apple.com');
    expect(ios.headers.get('cache-control')).toBe('private, no-store');
    expect(ios.headers.get('x-robots-tag')).toBe('noindex');
    expect(at(ANDROID_UA).headers.get('location')).toContain('play.google.com');
    expect(at('Mozilla/5.0 (Windows NT 10.0)').headers.get('location')).toMatch(/^\//);
  });
});

describe('proxy (CSP, link routes, canonical referral URLs)', () => {
  async function proxy() {
    return (await import('../../src/proxy.ts')).default;
  }

  it('308s a non-canonical referral code, keeping the locale prefix', async () => {
    const run = await proxy();
    const response = run(new NextRequest(`https://dijitalasistan.app/en/r/${VALID.toLowerCase()}`));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://dijitalasistan.app/en/r/${VALID}`);
  });

  it('rewrites an unprefixed link route to the negotiated locale with a nonce CSP and noindex', async () => {
    const run = await proxy();
    const response = run(
      new NextRequest(`https://dijitalasistan.app/r/${VALID}`, {
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `https://dijitalasistan.app/en/r/${VALID}`,
    );
    expect(response.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('passes site pages through the locale middleware with the CSP header', async () => {
    const run = await proxy();
    const response = run(new NextRequest('https://dijitalasistan.app/pricing'));
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    const malformed = run(new NextRequest('https://dijitalasistan.app/r/%E0%A4%A'));
    expect(malformed.status).not.toBe(308);
  });
});
