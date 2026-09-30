import { expect, test } from '@playwright/test';

import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';

/* BO-E2E-02…05 (contract tier): user search, user detail tabs, reveal and the operations push test. */

const USER_ID = '0190f5e0-1111-7000-8000-00000000abcd';
const REASON = 'Kullanıcı destek talebi DA-10240 için kontrol';

test.describe('users', () => {
  test('lists masked users, filters by plan and finds a user by email without putting it in the URL', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/users');
    const table = page.getByRole('table');
    await expect(table.getByText('yu***@gmail.com')).toBeVisible();
    await expect(page.getByText('yusuf.demir@gmail.com')).toHaveCount(0);

    await page.goto('/users?f.plan=pro');
    await expect(table.getByText('el***@outlook.com')).toHaveCount(0);
    await expect(table.getByText('ze***@icloud.com')).toBeVisible();

    await page.goto('/users');
    await page.getByRole('textbox', { name: 'E-postayla bul' }).fill('yusuf.demir@gmail.com');
    await page.getByRole('button', { name: 'E-postayla bul' }).click();
    await expect(page).toHaveURL(new RegExp(`/users/${USER_ID}/overview$`));
    expect(page.url()).not.toContain('yusuf');
    const lookup = (await mockCalls(request)).find((c) => c.path === '/users/lookup');
    expect(lookup?.body).toEqual({ email: 'yusuf.demir@gmail.com' });
  });

  test('user detail tabs render their own reads', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto(`/users/${USER_ID}`);
    await expect(page).toHaveURL(new RegExp(`/users/${USER_ID}/overview$`));
    await expect(page.getByTestId('user-id')).toHaveText(USER_ID);
    const tabs = page.getByRole('navigation', { name: 'Kullanıcı sekmeleri' });
    for (const [tab, path] of [
      ['Entegrasyonlar', 'integrations'],
      ['Brifingler', 'briefings'],
      ['Kullanım', 'usage'],
      ['Abonelik', 'subscription'],
      ['Davetler', 'referrals'],
      ['Destek', 'support'],
      ['Denetim', 'audit'],
    ] as const) {
      await tabs.getByRole('link', { name: tab }).click();
      await expect(page).toHaveURL(new RegExp(`/users/${USER_ID}/${path}$`));
      await expect(page.getByText('Veriler yüklenemedi.')).toHaveCount(0);
    }
    const reads = new Set((await mockCalls(request)).map((c) => c.path));
    for (const path of [
      'integrations',
      'briefings',
      'usage',
      'subscription',
      'referrals',
      'support',
      'audit',
    ]) {
      expect(reads.has(`/users/${USER_ID}/${path}`), path).toBe(true);
    }
  });

  test('operations sends a test push to one device with a reason', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto(`/users/${USER_ID}/overview`);
    await page.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Test bildirimi gönder…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test bildirimi gönder' });
    await expect(
      dialog.getByText('“Dijital Asistan” / “Test bildirimi”', { exact: false }),
    ).toBeVisible();
    await dialog.getByRole('radio', { name: /iOS/ }).first().check();
    await confirmDialog(page, 'Test bildirimi gönder', { reason: REASON });
    await expect(
      page.getByText('Test bildirimi kuyruğa alındı. Makbuz bekleniyor.').first(),
    ).toBeVisible();
    const call = (await mockCalls(request)).find((c) => c.path === '/notifications/test-push');
    expect(call?.body).toMatchObject({ user_id: USER_ID, reason: REASON, confirm: true });
    expect(call?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    const audit = await mockAudit(request);
    expect(audit.at(-1)).toMatchObject({ action: 'push.test_sent', reason: REASON });
  });

  test('support reveals the email for 60 seconds with an audited reason', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'support');
    await page.goto(`/users/${USER_ID}/overview`);
    await page.getByRole('button', { name: 'E-posta değerini göster' }).click();
    await confirmDialog(page, 'Bilgiyi göster', { reason: REASON });
    await expect(page.getByText('yusuf.demir@gmail.com').first()).toBeVisible();
    expect((await mockAudit(request)).at(-1)).toMatchObject({
      action: 'user.pii_revealed',
      reason: REASON,
    });
  });

  test('operations cannot reveal PII', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto(`/users/${USER_ID}/overview`);
    await expect(page.getByRole('button', { name: 'E-posta değerini göster' })).toHaveCount(0);
  });
});
