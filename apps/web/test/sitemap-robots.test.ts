import { afterEach, describe, expect, it, vi } from 'vitest';

const LAUNCH = {
  APP_ENV: 'production',
  SITE_INDEXABLE: 'true',
  NEXT_PUBLIC_SITE_URL: 'https://dijitalasistan.app',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  API_PUBLIC_BASE_URL: 'https://project.supabase.co',
  IOS_APP_STORE_ID: '1234567890',
  COMPANY_LEGAL_NAME: 'Example A.Ş.',
  COMPANY_ADDRESS: 'İstanbul',
  COMPANY_MERSIS_NO: '0123456789000015',
  COMPANY_KEP_ADDRESS: 'example@hs01.kep.tr',
};

function stub(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('sitemap (W-SYS-03)', () => {
  it('lists every public page in both locales with hreflang alternates', async () => {
    stub(LAUNCH);
    const { default: sitemap } = await import('../src/app/sitemap.ts');
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://dijitalasistan.app/',
      'https://dijitalasistan.app/en',
      'https://dijitalasistan.app/pricing',
      'https://dijitalasistan.app/en/pricing',
      'https://dijitalasistan.app/privacy',
      'https://dijitalasistan.app/en/privacy',
      'https://dijitalasistan.app/terms',
      'https://dijitalasistan.app/en/terms',
      'https://dijitalasistan.app/support',
      'https://dijitalasistan.app/en/support',
      'https://dijitalasistan.app/data-deletion',
      'https://dijitalasistan.app/en/data-deletion',
    ]);
    expect(entries[3]?.alternates?.languages).toEqual({
      tr: 'https://dijitalasistan.app/pricing',
      en: 'https://dijitalasistan.app/en/pricing',
      'x-default': 'https://dijitalasistan.app/pricing',
    });
    for (const entry of entries) expect(entry.url).not.toMatch(/\/(r|oauth|app|get)(\/|$)/u);
  });
});

describe('robots (W-SYS-04)', () => {
  it('production + SITE_INDEXABLE allows / and keeps link routes out', async () => {
    stub(LAUNCH);
    const { default: robots } = await import('../src/app/robots.ts');
    expect(robots()).toEqual({
      rules: [{ userAgent: '*', allow: '/', disallow: ['/r/', '/oauth/', '/app/', '/get'] }],
      sitemap: 'https://dijitalasistan.app/sitemap.xml',
    });
  });

  it('every other environment disallows everything', async () => {
    stub({ ...LAUNCH, APP_ENV: 'staging' });
    const { default: robots } = await import('../src/app/robots.ts');
    expect(robots()).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
  });

  it('a Vercel preview of production is not indexable', async () => {
    stub({ ...LAUNCH, VERCEL_ENV: 'preview' });
    const { default: robots } = await import('../src/app/robots.ts');
    expect(robots()).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
  });
});
