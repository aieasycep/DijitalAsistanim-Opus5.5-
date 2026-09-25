import { expect, test } from '@playwright/test';

import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';

/* BO-E2E-18/19 (contract tier): feature flag targeting, evaluation preview and kill switch (R-10). */

const REASON = 'Kademeli açılış planına göre yüzde artırımı';

test.describe('feature flags', () => {
  test('targeting is edited, previewed for a user and killed with the typed key', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/flags');
    await page.getByRole('link', { name: 'feature.voice' }).click();
    const detail = page.locator('#main').getByTestId('flag-detail');
    await expect(detail).toBeVisible();

    await page.getByTestId('flag-edit').click();
    const edit = page.getByRole('dialog', { name: 'feature.voice hedeflemesi' });
    await edit.getByLabel('Yüzde').fill('50');
    await confirmDialog(page, 'feature.voice hedeflemesi', { reason: REASON });
    await expect(page.getByText('Hedefleme kaydedildi.').first()).toBeVisible();
    const patch = (await mockCalls(request)).find(
      (c) => c.method === 'PATCH' && c.path === '/flags/feature.voice',
    );
    expect(patch?.body).toMatchObject({ rollout_percent: 50, reason: REASON });

    const evaluate = page.getByRole('region', { name: 'Değerlendirme önizlemesi' });
    await evaluate.getByLabel('Kullanıcı kimliği').fill('0190f5e0-1111-7000-8000-00000000abcd');
    await page.getByTestId('flag-evaluate').click();
    await expect(page.getByTestId('flag-evaluation').first()).toBeVisible();

    await page.getByTestId('flag-kill').click();
    await confirmDialog(page, 'feature.voice acil kapatılsın mı?', {
      reason: 'Sesli brifingde çökme artışı gözlendi',
      typed: 'feature.voice',
    });
    await expect(page.getByText('Acil kapatıldı', { exact: true }).first()).toBeVisible();
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'flag.kill_switch_on' });
    await expect(page.getByTestId('flag-enable').first()).toBeVisible();
  });

  test('ai_ops may write ai.* flags but not product flags', async ({ page, request }) => {
    await signInAs(page, request, 'ai_ops');
    await page.goto('/flags?flag=ai.batch.enabled');
    await expect(page.getByTestId('flag-edit')).toBeEnabled();
    await page.goto('/flags?flag=feature.voice');
    await expect(page.getByTestId('flag-detail').first()).toBeVisible();
    await expect(page.getByTestId('flag-edit')).toHaveCount(0);
  });
});
