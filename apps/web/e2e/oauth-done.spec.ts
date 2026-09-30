import { expect, test } from '@playwright/test';
import { ANDROID_UA, IPHONE_UA } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

const COMPLETION_CODE = 'Qm9vdHN0cmFwLWNvbXBsZXRpb24tY29kZS0wMTIzNDU'; // 43 base64url chars
const STATE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PENDING = `/oauth/done?provider=google&result=pending_confirmation&completion_code=${COMPLETION_CODE}&state_id=${STATE_ID}`;

test.describe('OAuth done (WEB-E2E-08, R-07)', () => {
  test('iPhone: "Uygulamaya dön" forwards only the allow-listed query to integrations/callback', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(
      `${PENDING}&code=provider-secret&access_token=leak&error_description=%3Cb%3Ex%3C/b%3E`,
    );
    await expect(page.locator('h1')).toHaveText('Bir adım kaldı.');
    const link = page.getByRole('link', { name: /uygulamaya dön/iu });
    const href = await link.getAttribute('href');
    expect(href).toBe(
      `dijitalasistan://integrations/callback?provider=google&result=pending_confirmation&completion_code=${COMPLETION_CODE}&state_id=${STATE_ID}`,
    );
    // Never "connected", and never the code or a token as text.
    const text = await page.locator('body').innerText();
    expect(text).not.toContain(COMPLETION_CODE);
    expect(text).not.toContain('provider-secret');
    expect(text).not.toContain('leak');
    expect(text).not.toMatch(/bağlandı\b/iu);
    // Nothing outside the allow-list reaches a link either.
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const value of hrefs) {
      expect(value).not.toContain('provider-secret');
      expect(value).not.toContain('access_token');
    }
    await context.close();
  });

  test('Android: an intent URL with a Play fallback', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: ANDROID_UA,
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    await page.goto(PENDING);
    const href = await page.getByRole('link', { name: /uygulamaya dön/iu }).getAttribute('href');
    expect(href).toMatch(
      /^intent:\/\/integrations\/callback\?provider=google&result=pending_confirmation&completion_code=/u,
    );
    expect(href).toContain(
      '#Intent;scheme=dijitalasistan;package=com.dijitalasistan.app;S.browser_fallback_url=',
    );
    await context.close();
  });

  test('desktop explains that the flow finishes on the phone', async ({ page }) => {
    await page.goto(PENDING);
    await expect(page.getByTestId('oauth-desktop')).toBeVisible();
    await expect(page.getByRole('link', { name: /uygulamaya dön/iu })).toHaveCount(0);
  });

  test('a pending result without a valid completion code is an error, not a success', async ({
    page,
  }) => {
    await page.goto(
      '/oauth/done?provider=google&result=pending_confirmation&completion_code=short',
    );
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'error');
  });

  test('denied, expired, mismatch and admin-consent variants', async ({ page }) => {
    const cases: [string, string][] = [
      ['provider=google&result=denied', 'denied'],
      ['provider=google&result=denied&error_code=scope_missing', 'scope'],
      ['provider=google&result=error&error_code=account_mismatch', 'mismatch'],
      ['provider=microsoft&result=expired_state', 'expired'],
      ['provider=microsoft&result=admin_consent_required', 'admin'],
    ];
    for (const [query, variant] of cases) {
      await page.goto(`/oauth/done?${query}`);
      await expect(page.locator('[data-variant]'), query).toHaveAttribute('data-variant', variant);
    }
    await expect(page.locator('main a[href="/support#faq-admin-consent"]')).toBeVisible();
  });

  test('headers: no-referrer, no-store, noindex', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}${PENDING}`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['x-robots-tag']).toContain('noindex');
  });
});
