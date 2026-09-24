import { expect, test } from '@playwright/test';

import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';
import { FAILED_EXPORT_ID as EXPORT_ID, uid } from './mock-data';

/* BO-E2E-20/21 (contract tier): audit log (read-only, chain verification) and data requests. */

test.describe('privacy operations', () => {
  test('audit rows are filtered, verified as a chain and opened read-only', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/audit');
    await expect(page.getByRole('table').first()).toContainText('admin.flag.updated');

    await page.goto('/audit?f.result=denied');
    await expect(page.getByRole('table').first()).toContainText('admin.permission_denied');
    await expect(page.getByRole('table').first()).not.toContainText('admin.flag.updated');

    await page.getByRole('link', { name: '24 saat' }).click();
    await expect(page.getByTestId('audit-verified').first()).toContainText(
      'Denetim zinciri doğrulandı: 24 saat',
    );

    await page.goto(`/audit?id=${uid('eeee', 2)}`);
    const detail = page.locator('#main').getByTestId('audit-detail');
    await expect(detail).toContainText('admin.user.force_sync');
    await expect(detail).toContainText('Kullanıcı senkron sorunu bildirdi');
    await expect(page.getByRole('button', { name: /Sil|Düzenle/ })).toHaveCount(0);
  });

  test('a failed export is retried from its failed step', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/data-requests');
    await page.getByRole('link', { name: EXPORT_ID.slice(0, 8) }).click();
    const detail = page.locator('#main').getByTestId('data-request-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('data-request-steps').first()).toContainText(
      'storage_write_failed',
    );
    await expect(page.getByTestId('data-request-regenerate')).toBeDisabled();
    await page.getByTestId('data-request-retry').click();
    await confirmDialog(page, 'Talep yeniden denensin mi?', {
      reason: 'Depolama kesintisi giderildi, yeniden deneme',
    });
    await expect(page.getByText('Talep yeniden kuyruğa alındı').first()).toBeVisible();
    expect(
      (await mockCalls(request)).some((c) => c.path === `/data-requests/export/${EXPORT_ID}/retry`),
    ).toBe(true);
    expect((await mockAudit(request)).at(-1)).toMatchObject({
      action: 'admin.data_request.retried',
    });
  });
});
