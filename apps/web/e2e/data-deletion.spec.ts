import { expect, test, type Page } from '@playwright/test';
import { stubOtp, stubState } from './helpers.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

const CODE_INFO =
  'Bu adrese bağlı bir Dijital Asistan hesabı varsa 6 haneli bir kod gönderdik. Kod 10 dakika geçerlidir.';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@known.example.com`;
}

async function requestCode(page: Page, email: string): Promise<void> {
  await page.goto('/data-deletion');
  // The submit button is enabled once the form has hydrated.
  await expect(page.getByRole('button', { name: 'Kod gönder' })).toBeEnabled();
  await page.getByLabel('Hesabındaki e-posta adresi').fill(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await expect(page.locator('form').getByText(CODE_INFO)).toBeVisible();
}

test.describe('data deletion (WEB-E2E-06)', () => {
  test('email → OTP → typed confirmation → request queued → status reachable', async ({ page }) => {
    const email = uniqueEmail('delete');
    await requestCode(page, email);
    const code = await stubOtp(email);
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel('6 haneli kod').fill(code ?? '');
    const submit = page.getByRole('button', { name: 'Hesabımı sil' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Onaylamak için SİL yaz').fill('sil');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId('deletion-reference')).toContainText(/Referans: DS-[0-9A-F]{6}/u);
    await expect(page.getByRole('heading', { name: 'Silme talebin alındı.' })).toBeVisible();
    await expect(page.getByTestId('subscription-warning')).toHaveCount(0);
    await page.getByRole('button', { name: 'Durumu kontrol et' }).click();
    await expect(page.getByText('Güncel durum: Siliniyor')).toBeVisible();

    const state = await stubState();
    const verify = state.requests.find(
      (entry) =>
        entry.path === '/data-deletion/verify' &&
        (entry.body as { email?: string } | null)?.email === email,
    );
    expect(verify?.bodyKeys).toEqual(['code', 'confirmation', 'email', 'kind', 'locale']);
    expect(verify?.body).toMatchObject({ kind: 'account', confirmation: 'SİL', locale: 'tr' });
    expect(verify?.origin).toBe(WEB_ORIGIN);
    const status = state.requests.find(
      (entry) => entry.path.startsWith('/data-deletion/') && entry.path.endsWith('/status'),
    );
    expect(status).toBeDefined();
  });

  test('an unknown email gets the same neutral response', async ({ page }) => {
    await requestCode(page, `nobody-${String(Date.now())}@example.com`);
    await expect(page.getByLabel('6 haneli kod')).toBeVisible();
  });

  test('a wrong code is rejected without revealing anything else', async ({ page }) => {
    const email = uniqueEmail('wrong');
    await requestCode(page, email);
    const code = await stubOtp(email);
    const wrong = code === '000000' ? '111111' : '000000';
    await page.getByLabel('6 haneli kod').fill(wrong);
    await page.getByLabel('Onaylamak için SİL yaz').fill('SİL');
    await page.getByRole('button', { name: 'Hesabımı sil' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Kod doğrulanamadı.');
    await expect(page.getByLabel('6 haneli kod')).toHaveAttribute('aria-invalid', 'true');
  });

  test('five wrong codes lock the flow', async ({ page }) => {
    const email = uniqueEmail('locked');
    await requestCode(page, email);
    const code = await stubOtp(email);
    const wrong = code === '000000' ? '111111' : '000000';
    await page.getByLabel('Onaylamak için SİL yaz').fill('SİL');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel('6 haneli kod').fill(wrong);
      await page.getByRole('button', { name: 'Hesabımı sil' }).click();
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
    }
    await page.getByLabel('6 haneli kod').fill(code ?? '');
    await page.getByRole('button', { name: 'Hesabımı sil' }).click();
    await expect(
      page.getByRole('heading', { name: 'Çok fazla hatalı deneme yapıldı.' }),
    ).toBeVisible();
  });

  test('an active store subscription is called out after the request', async ({ page }) => {
    const email = uniqueEmail('subscriber');
    await requestCode(page, email);
    await page.getByLabel('6 haneli kod').fill((await stubOtp(email)) ?? '');
    await page.getByLabel('Onaylamak için SİL yaz').fill('SİL');
    await page.getByRole('button', { name: 'Hesabımı sil' }).click();
    await expect(page.getByTestId('subscription-warning')).toContainText('aboneliğini iptal et');
  });

  test('resend waits 60 s; "change email" returns to the first step', async ({ page }) => {
    await requestCode(page, uniqueEmail('resend'));
    await expect(page.getByText(/sn sonra tekrar gönderebilirsin/u)).toBeVisible();
    await page.getByRole('button', { name: 'E-posta adresini değiştir' }).click();
    await expect(page.getByLabel('Hesabındaki e-posta adresi')).toBeVisible();
  });

  test('a rate-limited start shows the wait time', async ({ page }) => {
    await page.goto('/data-deletion');
    await expect(page.getByRole('button', { name: 'Kod gönder' })).toBeEnabled();
    await page.getByLabel('Hesabındaki e-posta adresi').fill('ratelimited@example.com');
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      '30 dakika sonra tekrar dene.',
    );
  });

  test('English flow asks for DELETE', async ({ page }) => {
    const email = uniqueEmail('english');
    await page.goto('/en/data-deletion');
    await expect(page.getByRole('button', { name: 'Send code' })).toBeEnabled();
    await page.getByLabel('Email address on your account').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('6-digit code').fill((await stubOtp(email)) ?? '');
    const submit = page.getByRole('button', { name: 'Delete my account' });
    await page.getByLabel('Type DELETE to confirm').fill('SİL');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('delete');
    await submit.click();
    await expect(page.getByTestId('deletion-reference')).toContainText('DS-');
  });

  test('the page sends no Referer and explains the scope', async ({ page }) => {
    const response = await page.goto('/data-deletion');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.getByTestId('deletion-scope')).toBeVisible();
    await expect(
      page.locator('main a[href="/support?category=privacy#contact"]').first(),
    ).toBeAttached();
  });
});
