import { expect, test } from '@playwright/test';

import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';

/* BO-E2E-15…17 (contract tier): AI cost, model routing guard (R-02) and prompt activation. */

const REASON = 'Değerlendirme raporu geçti, yeni sürüm yayında';

test.describe('AI operations', () => {
  test('cost, latency and requests come from the aggregates, never content', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'ai_ops');
    await page.goto('/ai?range=30d');
    await expect(page.getByTestId('ai-cost').first()).toBeVisible();
    await expect(page.getByTestId('ai-requests').first()).toBeVisible();
    await expect(page.getByTestId('chart-daily-cost').first()).toBeVisible();
    await expect(page.getByTestId('chart-cost-feature').first()).toBeVisible();
    await page.goto('/ai?tab=requests');
    await expect(page.getByRole('table').first()).toContainText('Sabah brifingi');
    const paths = (await mockCalls(request)).map((c) => c.path);
    expect(paths).toEqual(
      expect.arrayContaining(['/ai/metrics', '/ai/metrics/series', '/ai/requests']),
    );
  });

  test('a forbidden model family is refused before anything is sent', async ({ page, request }) => {
    await signInAs(page, request, 'ai_ops');
    await page.goto('/ai/models');
    await page.getByTestId('edit-balanced-email_triage').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model kimliği').fill(['claude', 'fable', '5'].join('-'));
    await dialog.getByLabel('Gerekçe').fill(REASON);
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.getByRole('alert')).toContainText('Bu model ailesi yönlendirilemez');
    expect(
      (await mockCalls(request)).some(
        (c) => c.method === 'PATCH' && c.path.startsWith('/ai/models/'),
      ),
    ).toBe(false);
  });

  test('a draft prompt is activated with a reason and the previous version is archived', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'ai_ops');
    await page.goto('/ai/prompts/briefing_morning?version=3');
    await expect(page.getByTestId('prompt-versions').first()).toBeVisible();
    // The version panel streams in behind a Suspense boundary; wait for the swapped-in copy only.
    const activate = page.getByTestId('prompt-version').getByTestId('prompt-activate');
    await expect(activate).toHaveCount(1);
    await activate.click();
    await confirmDialog(page, 'v3 sürümünü aktifleştir', { reason: REASON });
    await expect(page.getByText('v3 aktif.').first()).toBeVisible();
    expect((await mockAudit(request)).at(-1)).toMatchObject({
      action: 'admin.prompt.activated',
      reason: REASON,
    });
    await expect(page.getByTestId('prompt-activate')).toHaveCount(0);
    await page.goto('/ai/prompts/briefing_morning?version=2');
    await expect(page.getByTestId('prompt-rollback').first()).toBeVisible();
  });
});
