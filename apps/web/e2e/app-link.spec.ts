import { expect, test } from '@playwright/test';
import { ANDROID_UA } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

test.describe('app links (W-APP-01)', () => {
  test('/app/* explains the link opens in the app and offers the stores', async ({ page }) => {
    const response = await page.goto('/app/today');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(
      'Bu bağlantı Dijital Asistan uygulamasında açılır.',
    );
    await expect(page.getByRole('link', { name: "App Store'dan indir" })).toBeVisible();
    await expect(page.locator('[data-qr-placement="app_link"] svg[role="img"]')).toHaveAttribute(
      'data-qr-url',
      `${WEB_ORIGIN}/app/today`,
    );
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
  });

  test('Android: the intent opens the validated path; unknown roots fall back to the app root', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: ANDROID_UA,
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    await page.goto('/app/mail/3f2c9a44-0000-4000-8000-000000000001?utm=x');
    const intent = await page.getByRole('link', { name: 'Uygulamada aç' }).getAttribute('href');
    expect(intent).toMatch(
      /^intent:\/\/mail\/3f2c9a44-0000-4000-8000-000000000001#Intent;scheme=dijitalasistan;/u,
    );
    await page.goto('/app/%3Cscript%3E/x');
    const fallback = await page.getByRole('link', { name: 'Uygulamada aç' }).getAttribute('href');
    expect(fallback).toMatch(/^intent:\/\/#Intent;/u);
    await context.close();
  });

  test('the path is never rendered as text', async ({ page }) => {
    await page.goto('/app/person/secret-entity-id');
    expect(await page.locator('body').innerText()).not.toContain('secret-entity-id');
  });

  test('?lang=en renders English', async ({ page }) => {
    await page.goto('/app/today?lang=en');
    await expect(page.locator('h1')).toHaveText('This link opens in the Dijital Asistan app.');
  });
});
