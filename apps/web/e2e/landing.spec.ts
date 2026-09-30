import { expect, test } from '@playwright/test';
import { WEB_ORIGIN } from './stub/constants.ts';

const SECTION_ORDER = [
  'hero',
  'integrations',
  'how-it-works',
  'briefing',
  'mail',
  'meeting-prep',
  'planning',
  'memory',
  'security',
  'pricing',
  'faq',
  'download',
];

test.describe('landing (WEB-E2E-01, M§73)', () => {
  test('Turkish hero states the M§73 promise verbatim', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Bugün bilmen gerekenleri, sen sormadan söyler.');
    await expect(
      page
        .getByText(
          'Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar.',
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  });

  test('English hero', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('h1')).toHaveText(
      'Tells you what you need to know today — before you ask.',
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('all twelve sections appear once, in order', async ({ page }) => {
    await page.goto('/');
    const sections = await page
      .locator('[data-section]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section')));
    expect(sections).toEqual(SECTION_ORDER);
  });

  test('there is no sign-in link (C-24)', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /^(Giriş|Giriş yap|Sign in|Log in)$/i }),
    ).toHaveCount(0);
  });

  test('header CTA routes through /get', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('header').getByRole('link', { name: 'Ücretsiz Başla' });
    await expect(cta).toHaveAttribute('href', '/get?src=header');
  });

  test('store buttons use the configured store links', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('[data-section="hero"]');
    const appStore = hero.getByRole('link', { name: "App Store'dan indir" });
    await expect(appStore).toHaveAttribute(
      'href',
      'https://apps.apple.com/tr/app/id1234567890?pt=118000&ct=hero&mt=8',
    );
    const play = hero.getByRole('link', { name: "Google Play'den al" });
    const href = await play.getAttribute('href');
    expect(href).toContain('id=com.dijitalasistan.app');
    expect(href).toContain('referrer=utm_source%3Dweb%26utm_medium%3Dhero');
  });

  test('nav anchors scroll to the section, focus its heading and update the hash', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('header nav').getByRole('link', { name: 'Güvenlik' }).click();
    await expect(page).toHaveURL(/#security$/);
    await expect(page.locator('#security-title')).toBeFocused();
    await expect(page.locator('#security-title')).toBeInViewport();
  });

  test('integration chips are not interactive', async ({ page }) => {
    await page.goto('/');
    const chips = page.locator('#integrations li');
    await expect(chips.first()).toBeVisible();
    expect(await page.locator('#integrations a, #integrations button').count()).toBe(0);
    await expect(page.locator('#integrations')).toContainText(
      'Ücretsiz planda 1 mail hesabı ve 1 takvim',
    );
  });

  test('home FAQ shows the eight featured questions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#faq details')).toHaveCount(8);
  });

  test('footer links resolve', async ({ page, request }) => {
    await page.goto('/');
    const hrefs = await page
      .locator('footer a[href^="/"]')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
    expect(hrefs.length).toBeGreaterThan(4);
    for (const href of new Set(hrefs.map((h) => h.split('#')[0] ?? h))) {
      const response = await request.get(`${WEB_ORIGIN}${href}`);
      expect(response.status(), href).toBe(200);
    }
  });
});
