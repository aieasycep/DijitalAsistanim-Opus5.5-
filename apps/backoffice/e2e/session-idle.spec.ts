import { expect, test } from '@playwright/test';

import { advanceClocks, mockCalls, resetMock, signIn } from './helpers';

/*
 * BO-E2E-05 (contract tier) with Playwright's fake clock: the T−2 min warning, "Oturumu sürdür",
 * and the idle expiry that signs out to /login?reason=idle.
 */

test.describe('idle session', () => {
  test('warns at T−2 min, then signs out at the idle deadline', async ({
    page,
    context,
    request,
  }) => {
    await resetMock(request, { enrolled: true });
    await page.clock.install();
    await signIn(page, { enrolled: true });

    await advanceClocks(page, request, 28 * 60_000 + 10_000);
    const warning = page.getByRole('dialog', { name: 'Oturumun kapanmak üzere' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(
      'Hareketsizlik nedeniyle oturumun 2 dakika içinde kapanacak.',
    );
    await expect(warning.getByRole('timer')).toContainText('Kalan süre: 01:');

    await advanceClocks(page, request, 2 * 60_000 + 30_000);
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    await expect(
      page.getByText('Güvenliğin için oturumun kapatıldı. Lütfen tekrar giriş yap.'),
    ).toBeVisible();
    const auth = (await context.cookies()).filter((c) => /^__Host-da_admin(\.\d+)?$/.test(c.name));
    expect(auth).toEqual([]);
  });

  test('"Oturumu sürdür" sends a heartbeat and closes the warning', async ({ page, request }) => {
    await resetMock(request, { enrolled: true });
    await page.clock.install();
    await signIn(page, { enrolled: true });
    await advanceClocks(page, request, 28 * 60_000 + 10_000);
    const warning = page.getByRole('dialog', { name: 'Oturumun kapanmak üzere' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Oturumu sürdür' }).click();
    await expect(warning).toBeHidden();
    const calls = await mockCalls(request);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/session/heartbeat')).toBe(true);
    // The heartbeat moved the idle deadline: 28 more minutes stay quiet.
    await advanceClocks(page, request, 27 * 60_000);
    await expect(warning).toBeHidden();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
