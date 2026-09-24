import { expect, test } from '@playwright/test';
import { ANDROID_UA } from './helpers.ts';
import {
  STUB_UNAVAILABLE_REFERRAL,
  STUB_UNKNOWN_REFERRAL,
  STUB_VALID_REFERRAL,
  WEB_ORIGIN,
} from './stub/constants.ts';

test.describe('referral landing (WEB-E2E-07)', () => {
  test('a valid code shows the code, the reward and store links carrying the code', async ({
    page,
  }) => {
    const response = await page.goto(`/r/${STUB_VALID_REFERRAL}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('referral-code')).toHaveText(STUB_VALID_REFERRAL);
    await expect(page.getByTestId('referral-reward')).toContainText('14 gün Pro');
    const play = await page.getByRole('link', { name: "Google Play'den al" }).getAttribute('href');
    expect(play).toContain(`referrer=code%3D${STUB_VALID_REFERRAL}`);
    await expect(page.getByRole('link', { name: "App Store'dan indir" })).toHaveAttribute(
      'href',
      /^https:\/\/apps\.apple\.com\/tr\/app\/id1234567890\?pt=118000&ct=referral&mt=8$/u,
    );
    // The QR encodes the referral URL itself, so a phone with the app installed opens it in-app.
    await expect(page.locator('[data-qr-placement="referral"] svg[role="img"]')).toHaveAttribute(
      'data-qr-url',
      `${WEB_ORIGIN}/r/${STUB_VALID_REFERRAL}`,
    );
  });

  test('Android gets an "open in app" intent to settings/referral with a Play fallback', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: ANDROID_UA,
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    await page.goto(`/r/${STUB_VALID_REFERRAL}`);
    const intent = await page.getByRole('link', { name: 'Uygulamada aç' }).getAttribute('href');
    expect(intent).toMatch(
      new RegExp(
        `^intent://settings/referral\\?code=${STUB_VALID_REFERRAL}#Intent;scheme=dijitalasistan;package=com\\.dijitalasistan\\.app;S\\.browser_fallback_url=https%3A%2F%2Fplay\\.google\\.com`,
        'u',
      ),
    );
    await context.close();
  });

  test('unknown and malformed codes get the same neutral page (no enumeration signal)', async ({
    page,
  }) => {
    const unknown = await page.goto(`/r/${STUB_UNKNOWN_REFERRAL}`);
    const unknownText = await page.locator('main').innerText();
    await expect(page.getByTestId('referral-code')).toHaveCount(0);
    const malformed = await page.goto('/r/QQQQQQQ');
    const malformedText = await page.locator('main').innerText();
    expect(unknown?.status()).toBe(malformed?.status());
    expect(unknownText).toBe(malformedText);
    await expect(page.locator('h1')).toHaveText('Bu davet bağlantısı geçerli değil.');
  });

  test('when the lookup is unavailable the code is still shown, without the reward claim', async ({
    page,
  }) => {
    await page.goto(`/r/${STUB_UNAVAILABLE_REFERRAL}`);
    await expect(page.getByTestId('referral-code')).toHaveText(STUB_UNAVAILABLE_REFERRAL);
    await expect(page.getByTestId('referral-unverified')).toBeVisible();
    await expect(page.getByTestId('referral-reward')).toHaveCount(0);
  });

  test('codes are canonicalised with a 308 and the page is noindex', async ({ request }) => {
    const lower = STUB_VALID_REFERRAL.toLowerCase();
    const redirect = await request.get(`${WEB_ORIGIN}/r/${lower.slice(0, 4)}-${lower.slice(4)}`, {
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(308);
    expect(redirect.headers().location).toMatch(new RegExp(`/r/${STUB_VALID_REFERRAL}$`, 'u'));
    const page = await request.get(`${WEB_ORIGIN}/r/${STUB_VALID_REFERRAL}`);
    expect(page.headers()['x-robots-tag']).toContain('noindex');
    expect(page.headers()['referrer-policy']).toBe('no-referrer');
    expect(await page.text()).toMatch(/<meta name="robots" content="noindex/u);
  });

  test('?lang=en renders English at the same URL', async ({ page }) => {
    await page.goto(`/r/${STUB_VALID_REFERRAL}?lang=en`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('referral-reward')).toContainText('14 days of Pro');
  });
});
