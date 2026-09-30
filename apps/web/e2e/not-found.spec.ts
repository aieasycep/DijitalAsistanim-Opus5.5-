import { expect, test } from '@playwright/test';

test.describe('not found (WEB-E2E-16, W-ERR-01)', () => {
  for (const [path, title, home] of [
    ['/bu-sayfa-yok', 'Aradığın sayfa bulunamadı.', 'Ana sayfaya dön'],
    ['/en/no-such-page', 'Page not found.', 'Back to home'],
    ['/pricing/extra', 'Aradığın sayfa bulunamadı.', 'Ana sayfaya dön'],
  ] as const) {
    test(`${path} → 404 page with a link home`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator('h1')).toHaveText(title);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
      await page.getByRole('link', { name: home }).click();
      await expect(page.locator('[data-section="hero"]')).toBeVisible();
    });
  }

  test('unsupported locale prefixes and dotted paths are 404', async ({ request, baseURL }) => {
    for (const path of ['/de', '/de/pricing', '/favicon-old.png', '/wp-login.php']) {
      const response = await request.get(`${String(baseURL)}${path}`);
      expect(response.status(), path).toBe(404);
    }
  });
});
