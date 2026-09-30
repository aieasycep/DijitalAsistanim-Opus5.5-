import { expect, test } from '@playwright/test';

import { EMAIL_CODE } from './fixtures';
import { mockCalls, resetMock, signIn, watchCsp } from './helpers';

/*
 * BO-E2E-01 (contract tier): email one-time code → TOTP → dashboard, the generic answer for an
 * unknown email, sealed httpOnly/Secure/Strict cookies, and admin-api call headers.
 */

test.describe('admin sign-in', () => {
  test('first sign-in: email code → TOTP enrolment → recovery codes → dashboard', async ({
    page,
    context,
    request,
  }) => {
    await resetMock(request);
    const violations = await watchCsp(page);
    await signIn(page);

    // Real numbers from GET /dashboard/metrics, formatted tr-TR.
    await expect(page.getByTestId('kpi-total_users')).toHaveText('12.480');
    await expect(page.getByTestId('kpi-ai_cost_usd')).toContainText('412,37');
    await expect(
      page.getByRole('navigation', { name: 'Ana menü' }).getByRole('link', { name: 'Pano' }),
    ).toHaveAttribute('aria-current', 'page');

    const auth = (await context.cookies()).filter(
      (c) =>
        c.name.startsWith('__Host-da_admin') &&
        !c.name.includes('theme') &&
        !c.name.includes('locale'),
    );
    expect(auth.length).toBeGreaterThan(0);
    for (const cookie of auth) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('Strict');
      expect(cookie.path).toBe('/');
      expect(cookie.value.startsWith('v1.')).toBe(true);
      // A clear-text Supabase session would carry a JWT (`{"alg":…` → `eyJhbGciOi`).
      expect(cookie.value).not.toContain('eyJhbGciOi');
    }

    const calls = await mockCalls(request);
    const start = calls.find((c) => c.method === 'POST' && c.path === '/session/start');
    expect(start?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.some((c) => c.path === '/me/recovery-codes')).toBe(true);
    expect(
      calls.find((c) => c.path === '/me' && c.headers['x-da-activity'] === 'user'),
    ).toBeDefined();
    expect(await violations()).toEqual([]);
  });

  test('an enrolled admin is challenged and lands on the dashboard', async ({ page, request }) => {
    await resetMock(request, { enrolled: true });
    await signIn(page, { enrolled: true });
    await expect(page.getByRole('heading', { name: 'Kurtarma kodların' })).toHaveCount(0);
  });

  test('an unknown email gets the same answer and a wrong code a generic error', async ({
    page,
    request,
  }) => {
    await resetMock(request);
    await page.goto('/login');
    await page.getByLabel('E-posta').fill('someone@example.com');
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await expect(page).toHaveURL(/\/login\?step=code$/);
    await expect(
      page.getByText('Hesap mevcutsa 6 haneli giriş kodu e-postana gönderildi.'),
    ).toBeVisible();
    await page.getByLabel('E-posta kodu').fill(EMAIL_CODE);
    await page.getByRole('button', { name: 'Doğrula', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Kod hatalı' })).toHaveText(
      'Kod hatalı veya süresi dolmuş.',
    );
  });

  test('an unauthenticated visit is sent to the login page with its return path', async ({
    page,
  }) => {
    await page.goto('/dashboard?range=30d');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%3Frange%3D30d$/);
    await expect(page.getByRole('heading', { name: 'Yönetim paneline giriş' })).toBeVisible();
  });
});
