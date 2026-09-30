import { expect, test } from '@playwright/test';
import { SITE_PAGES, visibleText } from './helpers.ts';

/**
 * Proper nouns and fixture values that legitimately contain Turkish letters on English pages:
 * the Turkish language name in the switcher, the fixture company and address, the country name,
 * and Turkish registry and statute names and article letters cited in the legal text.
 */
const ALLOWED_TURKISH = [
  'Türkçe',
  'Örnek Yazılım A.Ş.',
  'Örnek Mah. Test Sok. No: 1, 34000 İstanbul',
  'İstanbul',
  'Kişisel Verilerin Korunması Kanunu',
  'Kişisel Verileri Koruma Kurumu',
  'Kişisel Verileri Koruma Kurulu',
  'Aydınlatma Metni',
  'Türkiye',
  'VERBİS',
  '(ç)',
];

/** Frequent Turkish words that should never appear in English copy. */
const TURKISH_WORDS =
  /\b(ve|bir|için|ile|bu|daha|olarak|gibi|sonra|değil|veya|kadar|hesabın|uygulama|verilerin)\b/giu;
const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/u;

function englishPath(path: string): string {
  return path === '/' ? '/en' : `/en${path}`;
}

test.describe('i18n (WEB-E2E-15)', () => {
  test('the language switcher keeps the path (and the anchor)', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('footer').getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/pricing$/u);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('footer').getByRole('link', { name: "Türkçe'ye geç" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/pricing$/u);
    await page.goto('/#security');
    await page.locator('header').getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en#security$/u);
  });

  for (const path of SITE_PAGES) {
    test(`${englishPath(path)} renders with no Turkish strings`, async ({ page }) => {
      await page.goto(englishPath(path));
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      let text = await visibleText(page);
      for (const noun of ALLOWED_TURKISH) text = text.replaceAll(noun, '');
      const offending = text
        .split('\n')
        .filter(
          (line) => TURKISH_LETTERS.test(line) || (line.match(TURKISH_WORDS)?.length ?? 0) >= 2,
        );
      expect(offending).toEqual([]);
    });
  }

  test('Turkish pages use Turkish casing for uppercase labels', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('FİYATLAR', { exact: true })).toBeVisible();
  });

  test('dates and numbers follow the locale', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('article[aria-labelledby="plan-pro"]')).toContainText('₺1.490');
    await page.goto('/en/pricing');
    await expect(page.locator('article[aria-labelledby="plan-pro"]')).toContainText('1,490');
  });
});
