import { expect, test } from '@playwright/test';

import { MOCK_ORIGIN } from './fixtures';
import { resetMock, signIn } from './helpers';

/* BO-E2E-06 (contract tier): sign-out, sign-out everywhere and a revoked session. */

test.describe('sign-out', () => {
  test('"Çıkış yap" ends the session and clears the cookies', async ({
    page,
    context,
    request,
  }) => {
    await resetMock(request, { enrolled: true });
    await signIn(page, { enrolled: true });
    await page.getByRole('button', { name: 'Hesap menüsü' }).click();
    await page.getByRole('menuitem', { name: 'Çıkış yap' }).click();
    const dialog = page.getByRole('dialog', { name: 'Çıkış yap' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Çıkış yap' }).click();
    await expect(page).toHaveURL(/\/login\?reason=logged_out$/);
    await expect(page.getByText('Çıkış yaptın.')).toBeVisible();
    const auth = (await context.cookies()).filter((c) => /^__Host-da_admin(\.\d+)?$/.test(c.name));
    expect(auth).toEqual([]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test('"Tüm oturumlardan çık" from the command palette confirms, then ends every session', async ({
    page,
    request,
  }) => {
    await resetMock(request, { enrolled: true });
    await signIn(page, { enrolled: true });
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Komut paleti' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('oturum');
    await palette.getByRole('option', { name: 'Tüm oturumlardan çık' }).click();
    const confirm = page.getByRole('dialog', { name: 'Tüm oturumlardan çık' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Tüm oturumlardan çık' }).click();
    await expect(page).toHaveURL(/\/login\?reason=logged_out$/);
    const state = (await (await request.get(`${MOCK_ORIGIN}/__mock/state`)).json()) as {
      sessions: { ended: boolean }[];
    };
    expect(state.sessions.every((s) => s.ended)).toBe(true);
  });

  test('a session revoked elsewhere lands on /login?reason=revoked', async ({ page, request }) => {
    await resetMock(request, { enrolled: true });
    await signIn(page, { enrolled: true });
    await request.post(`${MOCK_ORIGIN}/__mock/revoke`);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?reason=revoked$/);
    await expect(
      page.getByText('Oturumun başka bir cihazdan veya bir yönetici tarafından sonlandırıldı.'),
    ).toBeVisible();
  });
});
