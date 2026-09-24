import { expect, test } from '@playwright/test';
import { LOCALIZED_PAGES, stubState } from './helpers.ts';
import { STUB_ORIGIN, WEB_ORIGIN } from './stub/constants.ts';

/** Part 5 §0.9: first-party only — no third-party trackers, fonts, CDNs or cookies. */
test.describe('privacy on the wire', () => {
  test('pages load nothing from third parties and set no cookies', async ({ page, context }) => {
    test.setTimeout(90_000);
    const origins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    });
    for (const path of LOCALIZED_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect([...origins].sort()).toEqual([WEB_ORIGIN, STUB_ORIGIN].sort());
    expect(await context.cookies()).toEqual([]);
    const storage = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    }));
    expect(storage).toEqual({ local: 0, session: 0 });
  });

  test('analytics events carry only allow-listed, content-free fields', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('[data-section="hero"]')
      .getByRole('link', { name: "App Store'dan indir" })
      .evaluate((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
        });
      });
    await page
      .locator('[data-section="hero"]')
      .getByRole('link', { name: "App Store'dan indir" })
      .click();
    await expect.poll(async () => (await stubState()).events.length).toBeGreaterThan(0);
    const events = (await stubState()).events as Record<string, unknown>[];
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual([
        'device_class',
        'event',
        'locale',
        'page',
        'props',
        'theme',
      ]);
      expect(JSON.stringify(event)).not.toMatch(/@|user-agent|Mozilla/u);
    }
    // Browser events are CORS requests from the site; `/get` reports its redirect server-side.
    const requests = (await stubState()).requests.filter(
      (request) =>
        request.path === '/web-events' &&
        (request.body as { event?: string }).event !== 'web_get_redirect',
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request.origin).toBe(WEB_ORIGIN);
  });

  test('Global Privacy Control turns analytics off', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    });
    const page = await context.newPage();
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/web-events')) sent.push(request.url());
    });
    await page.goto('/pricing');
    await page.getByText('Aylık', { exact: true }).click();
    await page.waitForLoadState('networkidle');
    expect(sent).toEqual([]);
    await context.close();
  });
});
