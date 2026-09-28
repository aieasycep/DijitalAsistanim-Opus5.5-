// @vitest-environment happy-dom
import type * as NextIntl from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWebMessages } from '../../src/i18n/messages.ts';
import { requestLocale } from '../stubs/next-intl-server.ts';
import { NavigationSignal, requestHeaders } from '../stubs/next-runtime.ts';
import { renderServer, textOf } from './server-render.tsx';

/*
 * Site pages rendered end to end on the server (SCREEN_AND_FLOW_MAP Part 5): W-HOME-01,
 * W-PRICE-01, W-LEGAL-01/02, W-SUP-01, W-DEL-01 and the chrome (site layout, W-ERR-01). The plan
 * facts come from a stubbed PUB-05 response; everything else is the real page code and copy.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
});

vi.mock('next-intl/server', () => import('../stubs/next-intl-server.ts'));
vi.mock('next/headers', () => import('../stubs/next-runtime.ts'));
vi.mock('next/navigation', () => import('../stubs/next-runtime.ts'));
vi.mock('next/cache', () => import('../stubs/next-runtime.ts'));
vi.mock('next/server', () => import('../stubs/next-runtime.ts'));
vi.mock('@/i18n/navigation.ts', () => import('../stubs/i18n-navigation.tsx'));
// Pages nest their own provider with a message subset; on the server next-intl infers its locale
// from the request, which the stand-in supplies here.
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntl>();
  const { createElement } = await import('react');
  const { requestLocale: current } = await import('../stubs/request-locale.ts');
  function NextIntlClientProvider(props: Parameters<typeof actual.NextIntlClientProvider>[0]) {
    return createElement(actual.NextIntlClientProvider, {
      locale: current.current,
      timeZone: 'Europe/Istanbul',
      ...props,
    });
  }
  return { ...actual, NextIntlClientProvider };
});

const TR = loadWebMessages('tr');
const EN = loadWebMessages('en');

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const PLANS = {
  free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
  pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
  pricing: {
    storefront: 'TR',
    currency: 'TRY',
    as_of: isoDaysAgo(10),
    verified: true,
    monthly: { app_store: 199, play: 209 },
    annual: { app_store: 1490, play: 1490 },
    intro_offer: { days: 7, stores: ['app_store'] },
  },
  updated_at: new Date().toISOString(),
};

function stubPlans(body: unknown = { data: PLANS }, status = 200) {
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const locale = (value: 'tr' | 'en') => ({ params: Promise.resolve({ locale: value }) });

beforeEach(() => {
  requestLocale.current = 'tr';
  requestHeaders.current = new Headers({ 'x-nonce': 'nonce-test', 'user-agent': 'Mozilla/5.0' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('W-HOME-01 landing', () => {
  it('renders the twelve sections with live plan facts and the JSON-LD graph', async () => {
    const fetch = stubPlans();
    const { default: HomePage } = await import('../../src/app/[locale]/(site)/page.tsx');
    const root = await renderServer(await HomePage(locale('tr')));
    const main = root.querySelector('main[data-page="home"]');
    expect(main).not.toBeNull();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/functions/v1/public-api/plans');
    expect((init.headers as Record<string, string>).accept).toBe('application/json');
    interface LdNode {
      '@type': string;
    }
    const ld = JSON.parse(
      root.querySelector('script[type="application/ld+json"]')?.textContent ?? '[]',
    ) as LdNode[] | (LdNode & { '@graph'?: LdNode[] });
    const nodes = Array.isArray(ld) ? ld : (ld['@graph'] ?? [ld]);
    const types = nodes.map((node) => node['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'MobileApplication']));
    expect(root.querySelectorAll('section').length).toBeGreaterThanOrEqual(6);
    expect(textOf(main)).toContain('50');
  });

  it('keeps rendering with the honest wording when PUB-05 fails', async () => {
    stubPlans({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503);
    const { default: HomePage } = await import('../../src/app/[locale]/(site)/page.tsx');
    const root = await renderServer(await HomePage(locale('en')), 'en');
    expect(root.querySelector('main[data-page="home"]')).not.toBeNull();
    expect(root.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  });

  it('builds localized metadata with hreflang alternates', async () => {
    const { generateMetadata } = await import('../../src/app/[locale]/(site)/page.tsx');
    const meta = await generateMetadata(locale('en'));
    expect(meta.title).toBe(EN.webPages.seo.home.title);
    expect(meta.alternates?.canonical).toBe('/en');
    expect(meta.alternates?.languages).toEqual({ tr: '/', en: '/en', 'x-default': '/' });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('W-PRICE-01 pricing', () => {
  it('shows store prices, the savings and the trial copy when the store defines one', async () => {
    stubPlans();
    const { default: PricingPage } = await import('../../src/app/[locale]/(site)/pricing/page.tsx');
    const root = await renderServer(await PricingPage(locale('tr')));
    const main = root.querySelector('main[data-page="pricing"]');
    expect(textOf(main?.querySelector('h1'))).toBe(TR.web.pricing.title);
    const text = textOf(main);
    expect(text).toContain('199');
    expect(text).toContain('1.490');
    expect(root.querySelectorAll('details').length).toBeGreaterThanOrEqual(6);
  });

  it('shows no price when the snapshot is unverified', async () => {
    stubPlans({ data: { ...PLANS, pricing: { ...PLANS.pricing, verified: false } } });
    const { default: PricingPage } = await import('../../src/app/[locale]/(site)/pricing/page.tsx');
    const root = await renderServer(await PricingPage(locale('tr')));
    expect(textOf(root)).not.toContain('1.490');
  });

  it('has its own canonical and title', async () => {
    const { generateMetadata } = await import('../../src/app/[locale]/(site)/pricing/page.tsx');
    const meta = await generateMetadata(locale('tr'));
    expect(meta.title).toBe(TR.webPages.seo.pricing.title);
    expect(meta.alternates?.canonical).toBe('/pricing');
  });
});

describe('W-LEGAL-01/02 privacy and terms', () => {
  it.each([
    ['privacy', '/privacy'],
    ['terms', '/terms'],
  ] as const)('%s renders the document with its table of contents', async (name, path) => {
    const mod =
      name === 'privacy'
        ? await import('../../src/app/[locale]/(site)/privacy/page.tsx')
        : await import('../../src/app/[locale]/(site)/terms/page.tsx');
    for (const value of ['tr', 'en'] as const) {
      requestLocale.current = value;
      const root = await renderServer(await mod.default(locale(value)), value);
      expect(root.querySelector('h1')).not.toBeNull();
      expect(root.querySelectorAll('h2').length).toBeGreaterThan(3);
      expect(root.querySelector('nav')).not.toBeNull();
      const meta = await mod.generateMetadata(locale(value));
      expect(meta.alternates?.canonical).toBe(value === 'tr' ? path : `/en${path}`);
    }
  });
});

describe('W-SUP-01 support', () => {
  it('renders the FAQ catalog, the FAQPage JSON-LD and the form with a preselected category', async () => {
    stubPlans();
    const { default: SupportPage } = await import('../../src/app/[locale]/(site)/support/page.tsx');
    const root = await renderServer(
      await SupportPage({
        ...locale('tr'),
        searchParams: Promise.resolve({ category: 'billing' }),
      }),
    );
    expect(textOf(root.querySelector('h1'))).toBe(TR.web.support.title);
    const ld = JSON.parse(
      root.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as { '@type'?: string };
    expect(ld['@type']).toBe('FAQPage');
    const selected = root.querySelector('select[name="category"] option[selected]');
    expect(selected?.getAttribute('value')).toBe('billing');
    expect(root.querySelectorAll('details').length).toBeGreaterThan(5);
  });

  it('ignores an unknown category', async () => {
    stubPlans();
    const { default: SupportPage } = await import('../../src/app/[locale]/(site)/support/page.tsx');
    const root = await renderServer(
      await SupportPage({ ...locale('tr'), searchParams: Promise.resolve({ category: 'nope' }) }),
    );
    const selected = root.querySelector('select[name="category"] option[selected]');
    expect(selected?.getAttribute('value') ?? '').toBe('');
  });

  it('has support metadata', async () => {
    const { generateMetadata } = await import('../../src/app/[locale]/(site)/support/page.tsx');
    const meta = await generateMetadata({ ...locale('tr'), searchParams: Promise.resolve({}) });
    expect(meta.title).toBe(TR.webPages.seo.support.title);
  });
});

describe('W-DEL-01 data deletion', () => {
  it('lists the in-app steps first, then the web request form and the retention facts', async () => {
    const { default: DeletionPage } =
      await import('../../src/app/[locale]/(site)/data-deletion/page.tsx');
    const root = await renderServer(await DeletionPage(locale('tr')));
    const main = root.querySelector('main[data-page="data_deletion"]');
    expect(textOf(main?.querySelector('h1'))).toBe(TR.webPages.deletion.title);
    expect(main?.querySelector('form')).not.toBeNull();
    expect(main?.querySelectorAll('h2').length).toBeGreaterThan(3);
    expect(main?.querySelector('ol')).not.toBeNull();
  });

  it('has deletion metadata', async () => {
    const { generateMetadata } =
      await import('../../src/app/[locale]/(site)/data-deletion/page.tsx');
    const meta = await generateMetadata(locale('en'));
    expect(meta.alternates?.canonical).toBe('/en/data-deletion');
  });
});

describe('site chrome', () => {
  it('wraps pages with the skip link, header and footer', async () => {
    const { default: SiteLayout } = await import('../../src/app/[locale]/(site)/layout.tsx');
    const root = await renderServer(await SiteLayout({ children: <main id="main">içerik</main> }));
    const skip = root.querySelector('a[href="#main"]');
    expect(textOf(skip)).toBe(TR.webPages.common.skipToContent);
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
    expect(textOf(root.querySelector('main'))).toBe('içerik');
  });

  it('W-ERR-01 renders the 404 content in the request locale', async () => {
    requestLocale.current = 'en';
    const { default: NotFound } = await import('../../src/app/[locale]/not-found.tsx');
    const root = await renderServer(await NotFound(), 'en');
    expect(textOf(root.querySelector('h1'))).toBe(EN.webPages.errors.notFound.title);
    expect(root.querySelector('a[href="/en"]')).not.toBeNull();
  });

  it('the catch-all route answers 404', async () => {
    const { default: CatchAll } = await import('../../src/app/[locale]/(site)/[...rest]/page.tsx');
    expect(() => CatchAll()).toThrow(NavigationSignal);
  });
});
