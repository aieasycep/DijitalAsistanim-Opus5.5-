import { expect, test, type Page } from '@playwright/test';
import { stubState } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

/** M§62 support categories, in order. */
const CATEGORIES = [
  'Hesap',
  'Entegrasyon',
  'Senkronizasyon',
  'Faturalandırma',
  'AI kalitesi',
  'Bildirimler',
  'Gizlilik',
  'Diğer',
];
const ALLOWED_BODY_KEYS = new Set([
  'email',
  'name',
  'category',
  'message',
  'locale',
  'website',
  'captcha_token',
]);

async function fillForm(
  page: Page,
  email: string,
  message = 'Brifingim bu sabah gelmedi, yardımcı olur musunuz?',
): Promise<void> {
  const form = page.locator('#contact form');
  // The submit button is enabled once the form has hydrated.
  await expect(form.getByRole('button', { name: 'Gönder' })).toBeEnabled();
  await form.getByLabel('E-posta adresin').fill(email);
  await form.getByLabel('Konu').selectOption({ label: 'Senkronizasyon' });
  await form.getByLabel('Mesajın').fill(message);
}

test.describe('support (WEB-E2E-05)', () => {
  test('FAQ accordion works with Enter and Space', async ({ page }) => {
    await page.goto('/support');
    const item = page.locator('main details').first();
    const summary = item.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(item).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(item).not.toHaveAttribute('open', '');
  });

  test('a #faq-* deep link opens the matching question', async ({ page }) => {
    await page.goto('/support#faq-admin-consent');
    await expect(page.locator('#faq-admin-consent')).toHaveAttribute('open', '');
  });

  test('topics match M§62; ?category preselects and shows the privacy hint', async ({ page }) => {
    await page.goto('/support');
    const options = await page.locator('#contact select option').allInnerTexts();
    expect(options.slice(1)).toEqual(CATEGORIES);
    await page.goto('/support?category=privacy#contact');
    await expect(page.locator('#contact select')).toHaveValue('privacy');
    await expect(page.getByTestId('privacy-hint')).toBeVisible();
    await expect(page.getByTestId('privacy-hint').getByRole('link')).toHaveAttribute(
      'href',
      '/data-deletion',
    );
  });

  test('client validation lists the errors and focuses the summary', async ({ page }) => {
    await page.goto('/support');
    const form = page.locator('#contact form');
    await expect(form.getByRole('button', { name: 'Gönder' })).toBeEnabled();
    await form.getByLabel('E-posta adresin').fill('not-an-email');
    await form.getByLabel('Mesajın').fill('kısa');
    await form.getByRole('button', { name: 'Gönder' }).click();
    const summary = form.getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Geçerli bir e-posta adresi yaz.');
    await expect(summary).toContainText('Bir konu seç.');
    await expect(summary).toContainText('Mesajın en az 10 karakter olmalı.');
    await expect(form.getByLabel('E-posta adresin')).toHaveAttribute('aria-invalid', 'true');
    const sent = (await stubState()).requests.filter(
      (request) =>
        request.path === '/support' &&
        (request.body as { email?: string } | null)?.email === 'not-an-email',
    );
    expect(sent).toHaveLength(0);
  });

  test('a valid submission shows the reference; the body has only contract fields', async ({
    page,
  }) => {
    await page.goto('/support');
    const email = `e2e-support-${String(Date.now())}@example.com`;
    await fillForm(page, email);
    await page.locator('#contact form').getByRole('button', { name: 'Gönder' }).click();
    const success = page.getByTestId('support-success');
    await expect(success).toContainText(/Referans numaran: DA-2026-\d{6}\./u);
    await expect(page.getByRole('heading', { name: 'Talebini aldık.' })).toBeFocused();
    // The address is masked in the confirmation.
    await expect(success).not.toContainText(email);
    const state = await stubState();
    const request = state.requests.find(
      (entry) =>
        entry.path === '/support' && (entry.body as { email?: string } | null)?.email === email,
    );
    expect(request).toBeDefined();
    expect(request?.origin).toBe(WEB_ORIGIN);
    for (const key of request?.bodyKeys ?? []) expect(ALLOWED_BODY_KEYS.has(key), key).toBe(true);
    expect(request?.body).toMatchObject({ category: 'sync', locale: 'tr' });
    await page.getByRole('button', { name: 'Yeni talep oluştur' }).click();
    await expect(page.locator('#contact form').getByLabel('E-posta adresin')).toBeVisible();
  });

  test('429 shows the rate-limit copy', async ({ page }) => {
    await page.goto('/support');
    await fillForm(page, 'ratelimited@example.com');
    await page.locator('#contact form').getByRole('button', { name: 'Gönder' }).click();
    await expect(page.locator('#contact').getByRole('alert')).toContainText(
      'Çok fazla talep gönderildi. Lütfen bir saat sonra tekrar dene.',
    );
  });

  test('a 5xx shows the honest server-error copy with the support address', async ({ page }) => {
    await page.goto('/support');
    await fillForm(page, 'server-error@example.com');
    await page.locator('#contact form').getByRole('button', { name: 'Gönder' }).click();
    await expect(page.locator('#contact').getByRole('alert')).toContainText(
      'destek@dijitalasistan.app',
    );
    await expect(page.getByTestId('support-success')).toHaveCount(0);
  });

  test('offline: the network error offers a retry', async ({ page }) => {
    await page.goto('/support');
    await fillForm(page, `e2e-offline-${String(Date.now())}@example.com`);
    await page.route('**/functions/v1/public-api/support', (route) =>
      route.abort('internetdisconnected'),
    );
    await page.locator('#contact form').getByRole('button', { name: 'Gönder' }).click();
    const alert = page.locator('#contact').getByRole('alert');
    await expect(alert).toContainText('Gönderilemedi.');
    await page.unroute('**/functions/v1/public-api/support');
    await alert.getByRole('button', { name: 'Tekrar Dene' }).click();
    await expect(page.getByTestId('support-success')).toBeVisible();
  });

  test('English form sends locale "en"', async ({ page }) => {
    await page.goto('/en/support');
    const email = `e2e-en-${String(Date.now())}@example.com`;
    const form = page.locator('#contact form');
    await expect(form.getByRole('button', { name: 'Send' })).toBeEnabled();
    await form.getByLabel('Your email').fill(email);
    await form.getByLabel('Topic').selectOption('billing');
    await form.getByLabel('Your message').fill('Where can I see my invoices for the Pro plan?');
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('support-success')).toContainText('DA-2026-');
    const request = (await stubState()).requests.find(
      (entry) =>
        entry.path === '/support' && (entry.body as { email?: string } | null)?.email === email,
    );
    expect(request?.body).toMatchObject({ locale: 'en', category: 'billing' });
  });
});
