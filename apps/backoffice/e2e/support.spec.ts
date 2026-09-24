import { expect, test } from '@playwright/test';

import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';

/* BO-E2E-11…14 (contract tier): support tickets and Support Access (R-09, no impersonation). */

const TICKET_ID = '0190f5e0-8888-7000-8000-000000000001';
const USER_ID = '0190f5e0-1111-7000-8000-00000000abcd';
const REASON = 'DA-10240 senkron sorunu incelemesi için erişim';

test.describe('support', () => {
  test('a ticket gets an internal note, a reply and is closed', async ({ page, request }) => {
    await signInAs(page, request, 'support');
    await page.goto('/support');
    await page.getByRole('link', { name: 'DA-10240' }).click();
    await expect(page).toHaveURL(new RegExp(`/support/${TICKET_ID}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Gmail hesabım senkron olmuyor' }),
    ).toBeVisible();

    await page
      .getByLabel('Not veya yanıt')
      .fill('Hesap bağlantısı kontrol edildi, yeniden bağlanma önerilecek.');
    await page.getByRole('button', { name: 'İç not ekle' }).click();
    await expect(page.getByText('Not eklendi.').first()).toBeVisible();
    await expect(page.getByTestId('ticket-notes').first()).toContainText(
      'yeniden bağlanma önerilecek',
    );

    await page
      .getByLabel('Not veya yanıt')
      .fill('Merhaba, hesabını yeniden bağlaman sorunu çözecektir.');
    await page.getByRole('button', { name: 'Yanıtla…' }).click();
    await confirmDialog(page, 'Yanıtı gönder');
    await expect(page.getByText('Yanıt gönderim kuyruğuna alındı.').first()).toBeVisible();
    expect(
      (await mockCalls(request)).some((c) => c.path === `/support/tickets/${TICKET_ID}/reply`),
    ).toBe(true);

    await page.getByRole('button', { name: 'Kapat', exact: true }).click();
    await confirmDialog(page, 'Talebi kapat');
    await expect(page.getByText('Talep kapatıldı.').first()).toBeVisible();
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'admin.ticket.updated' });
  });

  test('Support Access: grant with step-up, view scoped content, revoke', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'support');
    await page.goto(`/users/${USER_ID}/overview`);
    await page.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Destek erişimi iste…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Destek erişimi iste' });
    await dialog.getByRole('checkbox', { name: 'E-posta üst verisi' }).check();
    await dialog.getByRole('radio', { name: '15 dk' }).check();
    await confirmDialog(page, 'Destek erişimi iste', {
      reason: REASON,
      typed: '00abcd',
      stepUp: true,
    });
    await expect(page.getByText('Destek erişimi başladı.').first()).toBeVisible();

    const banner = page.locator('#main').getByTestId('support-access-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('timer')).toContainText(/1[45]:\d\d/);
    await banner.getByLabel('Kapsam').selectOption('email_metadata');
    await banner.getByLabel(/Kayıt kimliği/).fill('0190f5e0-6666-7000-8000-000000000001');
    await banner.getByRole('button', { name: 'Göster' }).click();
    await expect(page.getByTestId('support-access-content').first()).toContainText(
      'Konu: Fatura hatırlatması',
    );
    expect(page.url()).not.toContain('entity_id');

    await banner.getByRole('button', { name: 'Erişimi sonlandır' }).click();
    await confirmDialog(page, 'Destek erişimini sonlandır', {
      reason: 'İnceleme tamamlandı, erişim kapatılıyor',
    });
    await expect(page.getByText('Destek erişimi sonlandırıldı.').first()).toBeVisible();
    await expect(page.getByTestId('support-access-banner')).toHaveCount(0);
    const actions = (await mockAudit(request)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['admin.support_access.granted', 'admin.support_access.revoked']),
    );
  });
});
