import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LOCALIZED_PAGES } from './helpers.ts';
import { STUB_VALID_REFERRAL } from './stub/constants.ts';

const PAGES = [
  ...LOCALIZED_PAGES,
  `/r/${STUB_VALID_REFERRAL}`,
  '/r/QQQQQQQ',
  '/oauth/done?provider=google&result=denied',
  '/app/today',
  '/does-not-exist',
];

test.describe('accessibility (WEB-E2E-13)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: no serious or critical violations (${scheme})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const failures: string[] = [];
      for (const path of PAGES) {
        await page.goto(path);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        for (const violation of results.violations) {
          if (violation.impact === 'serious' || violation.impact === 'critical') {
            failures.push(
              `${path} [${scheme}] ${violation.id}: ${violation.nodes
                .slice(0, 3)
                .map((node) => node.target.join(' '))
                .join(' | ')}`,
            );
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  test('axe on the open states: mobile menu, QR dialog, support errors', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'Menü' }).click();
    let results = await new AxeBuilder({ page }).include('dialog[open]').analyze();
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');
    await page
      .locator('[data-section="hero"]')
      .getByRole('button', { name: 'QR ile indir' })
      .click();
    results = await new AxeBuilder({ page }).include('dialog[open]').analyze();
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);

    await page.goto('/support');
    await page.locator('#contact form').getByRole('button', { name: 'Gönder' }).click();
    await expect(page.locator('#contact').getByRole('alert')).toBeVisible();
    results = await new AxeBuilder({ page }).include('#contact').analyze();
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });

  test('reduced motion: no animation runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const animated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((element) => getComputedStyle(element).animationName !== 'none')
        .map(
          (element) => `${element.tagName}.${(element.getAttribute('class') ?? '').slice(0, 40)}`,
        ),
    );
    expect(animated).toEqual([]);
    const smooth = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );
    expect(smooth).toBe('auto');
  });

  test('images and icons: decorative SVGs are hidden, meaningful ones are labelled', async ({
    page,
  }) => {
    await page.goto('/');
    const unlabelled = await page.locator('svg').evaluateAll((svgs) =>
      svgs
        .filter(
          (svg) =>
            svg.getAttribute('aria-hidden') !== 'true' &&
            svg.closest('[aria-hidden="true"]') === null,
        )
        .filter(
          (svg) =>
            (svg.getAttribute('aria-label') ?? '') === '' && svg.getAttribute('role') !== 'img',
        )
        .map((svg) => svg.outerHTML.slice(0, 80)),
    );
    expect(unlabelled).toEqual([]);
    const images = await page
      .locator('img')
      .evaluateAll((imgs) => imgs.filter((img) => !img.hasAttribute('alt')).length);
    expect(images).toBe(0);
  });

  test('landmarks: one banner, one main, one contentinfo', async ({ page }) => {
    for (const path of ['/', '/privacy', '/support']) {
      await page.goto(path);
      await expect(page.getByRole('banner'), path).toHaveCount(1);
      await expect(page.getByRole('main'), path).toHaveCount(1);
      await expect(page.getByRole('contentinfo'), path).toHaveCount(1);
    }
  });
});
