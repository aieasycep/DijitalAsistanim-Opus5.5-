import { expect, test } from '@playwright/test';

import { ADMIN_ID } from './fixtures';
import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';
import { uid } from './mock-data';

/* BO-E2E-22…26 (contract tier): entitlement grants (full and limited) and admin user management. */

const FREE_USER_ID = uid('1111', 8);
const REASON = 'Senkron kesintisi nedeniyle telafi erişimi';

test.describe('entitlements', () => {
  test('support may grant only 1 or 7 days from Support', async ({ page, request }) => {
    await signInAs(page, request, 'support');
    await page.goto(`/users/${FREE_USER_ID}/subscription`);
    await page.getByTestId('grant-pro').click();
    const dialog = page.getByRole('dialog', { name: 'Geçici Pro tanımla' });
    await expect(dialog.getByRole('radio', { name: '1 gün' })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '30 gün' })).toHaveCount(0);
    await expect(
      dialog.getByText(
        'Destek rolü yalnızca 1 veya 7 günlük, Destek kaynaklı erişim tanımlayabilir.',
      ),
    ).toBeVisible();
    await dialog.getByRole('radio', { name: '7 gün' }).check();
    await confirmDialog(page, 'Geçici Pro tanımla', { reason: REASON });
    await expect(page.getByText(/Pro erişimi tanımlandı; bitiş/).first()).toBeVisible();
    const call = (await mockCalls(request)).find(
      (c) => c.path === `/users/${FREE_USER_ID}/entitlement-grants`,
    );
    expect(call?.body).toMatchObject({
      duration_days: 7,
      source: 'support',
      reason: REASON,
      confirm: true,
    });
    await expect(page.getByTestId('effective-entitlement').first()).toContainText('Pro');
  });

  test('super_admin grants 30 days of compensation and revokes it', async ({ page, request }) => {
    await signInAs(page, request, 'super_admin');
    await page.goto(`/users/${FREE_USER_ID}/subscription`);
    await page.getByTestId('grant-pro').click();
    const dialog = page.getByRole('dialog', { name: 'Geçici Pro tanımla' });
    await dialog.getByRole('radio', { name: '30 gün' }).check();
    await dialog.getByRole('radio', { name: 'Telafi' }).check();
    await confirmDialog(page, 'Geçici Pro tanımla', { reason: REASON });
    await expect(page.getByText(/Pro erişimi tanımlandı; bitiş/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Geri al' }).first().click();
    await confirmDialog(page, 'Erişimi geri al', {
      reason: 'Yanlış kullanıcıya tanımlandı, geri alınıyor',
      typed: true,
    });
    await expect(page.getByText('Erişim geri alındı.').first()).toBeVisible();
    const actions = (await mockAudit(request)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['entitlement.granted', 'entitlement.revoked']));
  });
});

test.describe('admin users', () => {
  test('super_admin invites an admin with step-up; own row is protected', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'super_admin');
    await page.goto('/admins');
    await page.getByTestId(`admin-actions-${ADMIN_ID}`).click();
    await expect(page.getByRole('menuitem', { name: /Rolü değiştir/ })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /Rolü değiştir/ })).toContainText(
      'Kendi hesabınızda bu işlem yapılamaz.',
    );
    await page.keyboard.press('Escape');

    await page.getByTestId('admin-invite').click();
    const dialog = page.getByRole('dialog', { name: 'Yönetici davet et' });
    await dialog.getByLabel('E-posta').fill('yeni.analist@dijitalasistan.app');
    await dialog.getByLabel('Ad soyad').fill('Yeni Analist');
    await dialog.getByLabel('Rol', { exact: true }).selectOption('analyst');
    await confirmDialog(page, 'Yönetici davet et', {
      reason: 'Analitik ekibi için yeni hesap',
      stepUp: true,
    });
    await expect(page.getByText('Davet gönderildi').first()).toBeVisible();
    await expect(page.getByRole('table').first()).toContainText('yeni.analist@dijitalasistan.app');
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'admin.invited' });
  });

  test('operations sees the admin list read-only', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/admins');
    await expect(page.getByRole('table').first()).toContainText('kurucu@dijitalasistan.app');
    await expect(page.locator('[data-testid^="admin-actions-"]')).toHaveCount(0);
    await expect(page.getByTestId('admin-invite')).toHaveCount(0);
  });
});
