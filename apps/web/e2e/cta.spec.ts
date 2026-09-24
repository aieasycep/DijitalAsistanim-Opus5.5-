import { expect, test } from '@playwright/test';
import { ANDROID_UA, IPHONE_UA } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

test.describe('download CTAs (WEB-E2E-02)', () => {
  test('desktop ≥1200: the hero shows an inline QR code for the smart link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const qr = page.locator('[data-section="hero"] [data-qr-placement="qr_hero"] svg[role="img"]');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('aria-label', 'Uygulamayı indirmek için QR kod');
    await expect(qr).toHaveAttribute('data-qr-url', `${WEB_ORIGIN}/get?src=qr_hero`);
  });

  test('tablet 768–1199: the QR sits behind a dialog button (Esc closes, focus returns)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    const hero = page.locator('[data-section="hero"]');
    await expect(hero.locator('[data-qr-placement="qr_hero"]').first()).toBeHidden();
    const button = hero.getByRole('button', { name: 'QR ile indir' });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Telefonunla tara' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('svg[role="img"]')).toHaveAttribute(
      'data-qr-url',
      `${WEB_ORIGIN}/get?src=qr_hero`,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('mobile <768: store buttons, no QR', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const hero = page.locator('[data-section="hero"]');
    await expect(hero.getByRole('link', { name: "App Store'dan indir" })).toBeVisible();
    await expect(hero.getByRole('link', { name: "Google Play'den al" })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'QR ile indir' })).toBeHidden();
    await expect(hero.locator('svg[role="img"]:visible')).toHaveCount(0);
  });

  test('every CTA has an accessible name', async ({ page }) => {
    await page.goto('/');
    const unnamed = await page.locator('a, button').evaluateAll((elements) =>
      elements
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .filter(
          (element) => (element.getAttribute('aria-label') ?? element.textContent).trim() === '',
        )
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test('/get routes phones to their store and desktops to the download band', async ({
    request,
  }) => {
    const iphone = await request.get(`${WEB_ORIGIN}/get?src=qr_hero`, {
      headers: { 'user-agent': IPHONE_UA },
      maxRedirects: 0,
    });
    expect(iphone.status()).toBe(302);
    expect(iphone.headers().location).toBe(
      'https://apps.apple.com/tr/app/id1234567890?pt=118000&ct=qr_hero&mt=8',
    );
    const android = await request.get(`${WEB_ORIGIN}/get?src=qr_final`, {
      headers: { 'user-agent': ANDROID_UA },
      maxRedirects: 0,
    });
    expect(android.headers().location).toContain(
      'https://play.google.com/store/apps/details?id=com.dijitalasistan.app',
    );
    expect(android.headers().location).toContain('utm_medium%3Dqr_final');
    const desktop = await request.get(`${WEB_ORIGIN}/get?src=header`, {
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'accept-language': 'en-US' },
      maxRedirects: 0,
    });
    expect(desktop.headers().location).toBe('/en#download');
    expect(desktop.headers()['cache-control']).toBe('private, no-store');
    const unknownSrc = await request.get(`${WEB_ORIGIN}/get?src=<script>`, {
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'accept-language': 'tr-TR' },
      maxRedirects: 0,
    });
    expect(unknownSrc.headers().location).toBe('/#download');
  });
});
