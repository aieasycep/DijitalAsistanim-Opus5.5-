import { expect, test } from '@playwright/test';
import { LOCALIZED_PAGES } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

function trPath(path: string): string {
  if (path === '/en') return '/';
  return path.startsWith('/en/') ? path.slice(3) : path;
}

function enPath(path: string): string {
  const bare = trPath(path);
  return bare === '/' ? '/en' : `/en${bare}`;
}

/** Reads PNG width/height from the IHDR chunk. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.describe('SEO basics (WEB-E2E-12)', () => {
  test('titles and descriptions are unique across pages and locales', async ({ page }) => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const path of LOCALIZED_PAGES) {
      await page.goto(path);
      titles.add(await page.title());
      descriptions.add(
        (await page.locator('meta[name="description"]').getAttribute('content')) ?? '',
      );
    }
    expect(titles.size).toBe(LOCALIZED_PAGES.length);
    expect(descriptions.size).toBe(LOCALIZED_PAGES.length);
    expect(titles.has('')).toBe(false);
    expect(descriptions.has('')).toBe(false);
  });

  for (const path of LOCALIZED_PAGES) {
    test(`${path}: canonical, hreflang, OG/Twitter, robots, one h1 and a 1200×630 OG image`, async ({
      page,
      request,
    }) => {
      await page.goto(path);
      // Compared as URLs: `http://host` and `http://host/` are the same root URL.
      const href = async (selector: string): Promise<string> =>
        new URL((await page.locator(selector).getAttribute('href')) ?? '').href;
      expect(await href('link[rel="canonical"]')).toBe(new URL(path, WEB_ORIGIN).href);
      expect(await href('link[rel="alternate"][hreflang="tr"]')).toBe(
        new URL(trPath(path), WEB_ORIGIN).href,
      );
      expect(await href('link[rel="alternate"][hreflang="en"]')).toBe(
        new URL(enPath(path), WEB_ORIGIN).href,
      );
      expect(await href('link[rel="alternate"][hreflang="x-default"]')).toBe(
        new URL(trPath(path), WEB_ORIGIN).href,
      );
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/u);
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
        'content',
        path === '/en' || path.startsWith('/en/') ? 'en_US' : 'tr_TR',
      );
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /^index, follow/u,
      );
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
      const image = (await page.locator('meta[property="og:image"]').getAttribute('content')) ?? '';
      const response = await request.get(image);
      expect(response.status(), image).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
      expect(pngSize(await response.body())).toEqual({ width: 1200, height: 630 });
    });
  }

  test('the home and pricing pages carry valid SoftwareApplication JSON-LD', async ({ page }) => {
    for (const path of ['/', '/pricing', '/en/pricing']) {
      await page.goto(path);
      const blocks = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((scripts) =>
          scripts.map((script) => JSON.parse(script.textContent) as unknown),
        );
      const app = blocks
        .flatMap((block) => (Array.isArray(block) ? block : [block]) as Record<string, unknown>[])
        .find(
          (block) =>
            block['@type'] === 'MobileApplication' || block['@type'] === 'SoftwareApplication',
        );
      expect(app, path).toBeDefined();
      expect(app?.['@context']).toBe('https://schema.org');
      expect(app?.name).toBe('Dijital Asistan');
      expect(app?.operatingSystem).toBeTruthy();
      expect(app?.applicationCategory).toBeTruthy();
      const offers = app?.offers as { price: string; priceCurrency: string }[] | undefined;
      expect(offers?.some((offer) => offer.price === '0' && offer.priceCurrency === 'TRY')).toBe(
        true,
      );
    }
  });

  test('sitemap.xml lists every public page in both locales with alternates', async ({
    request,
  }) => {
    const response = await request.get(`${WEB_ORIGIN}/sitemap.xml`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    const xml = await response.text();
    for (const path of LOCALIZED_PAGES) {
      expect(xml, path).toContain(`<loc>${WEB_ORIGIN}${path}</loc>`);
    }
    expect(xml).toContain('hreflang="en"');
    expect(xml).not.toContain('/r/');
    expect(xml).not.toContain('/oauth/');
  });

  test('robots.txt allows / and disallows link routes', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/robots.txt`);
    const text = await response.text();
    expect(text).toMatch(/^Allow: \/$/mu);
    expect(text).toMatch(/^Disallow: \/r\/$/mu);
    expect(text).toMatch(/^Disallow: \/oauth\/$/mu);
    expect(text).toContain(`Sitemap: ${WEB_ORIGIN}/sitemap.xml`);
  });

  test('link routes are noindex and absent from hreflang', async ({ page }) => {
    await page.goto('/oauth/done?provider=google&result=denied');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  test('manifest and icons are served', async ({ request }) => {
    const manifest = await request.get(`${WEB_ORIGIN}/manifest.webmanifest`);
    expect(manifest.status()).toBe(200);
    const body = (await manifest.json()) as { name: string; icons: { src: string }[] };
    expect(body.name).toBe('Dijital Asistan');
    for (const icon of ['/icon', '/apple-icon']) {
      const response = await request.get(`${WEB_ORIGIN}${icon}`);
      expect(response.status(), icon).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
    }
  });
});
