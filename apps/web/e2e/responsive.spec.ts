import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, SITE_PAGES } from './helpers.ts';
import { STUB_VALID_REFERRAL } from './stub/constants.ts';

const WIDTHS = [360, 390, 768, 1024, 1280, 1440];
const PAGES = [
  ...SITE_PAGES,
  '/en',
  `/r/${STUB_VALID_REFERRAL}`,
  '/app/today',
  '/oauth/done?provider=google&result=denied',
];

test.describe('responsive layout (WEB-E2E-10, SREQ-94)', () => {
  for (const width of WIDTHS) {
    test(`no horizontal scroll at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await page.goto(path);
        await expectNoHorizontalScroll(page);
      }
    });
  }

  test('the nav collapses into a menu below 768 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const header = page.locator('header');
    await expect(header.getByRole('button', { name: 'Menü' })).toBeVisible();
    await expect(header.getByRole('navigation', { name: 'Ana menü' })).toBeHidden();
    // 768–1199: the primary links are inline and the rest sit in the menu (W-CMP-02).
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(header.getByRole('navigation', { name: 'Ana menü' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Ücretsiz Başla' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(header.getByRole('button', { name: 'Menü' })).toBeHidden();
    await expect(
      header.getByRole('navigation', { name: 'Ana menü' }).getByRole('link', { name: 'SSS' }),
    ).toBeVisible();
  });

  test('desktop content width stays within 1200–1440 px', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    const widths = await page
      .locator('.site-container')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
    const max = Math.max(...widths);
    expect(max).toBeGreaterThanOrEqual(1200);
    expect(max).toBeLessThanOrEqual(1440);
  });

  test('tap targets on mobile are at least 44 px high', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const small = await page
      .locator('header a, header button, [data-section="hero"] a, [data-section="hero"] button')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .filter((node) => node.getBoundingClientRect().height < 44)
          .map((node) => node.outerHTML.slice(0, 100)),
      );
    expect(small).toEqual([]);
  });
});
