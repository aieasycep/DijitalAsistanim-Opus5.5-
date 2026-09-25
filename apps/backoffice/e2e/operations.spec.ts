import { expect, test } from '@playwright/test';

import { MOCK_ORIGIN } from './fixtures';
import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';
import { DEAD_JOB_ID, FAILED_BRIEFING_ID, uid } from './mock-data';

/* BO-E2E-07…10 (contract tier): integration view, job retry and briefing operations. */

const REASON = 'Sağlayıcı kesintisi sonrası kontrollü tekrar';
const ACCOUNT_ID = uid('3333', 1);
const RUNNING_JOB_ID = uid('4444', 4);

test.describe('operations', () => {
  test('integration matrix, account detail and force sync', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/integrations');
    await expect(page.getByTestId('int-healthy').first()).toBeVisible();
    await page.goto(`/integrations?account=${ACCOUNT_ID}`);
    const detail = page.locator('#main').getByTestId('integration-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('gmail.readonly')).toBeVisible();
    await detail.getByRole('button', { name: 'Senkronu başlat' }).click();
    await confirmDialog(page, 'Hesap senkronunu başlat', { reason: REASON });
    await expect(page.getByText('1 iş kuyruğa alındı.').first()).toBeVisible();
    expect((await mockAudit(request)).at(-1)).toMatchObject({
      action: 'user.force_sync',
      target_id: ACCOUNT_ID,
    });
  });

  test('a dead-letter job is retried with a reason and shows its correlation chain', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/jobs?f.status=dead_letter');
    await expect(page.getByTestId(`retry-${DEAD_JOB_ID}`).first()).toBeVisible();
    await page.goto(`/jobs/${DEAD_JOB_ID}`);
    await expect(page.getByTestId('attempts-timeline').first()).toBeVisible();
    await expect(page.getByTestId('correlation-chain').first()).toBeVisible();
    await page.getByTestId(`retry-${DEAD_JOB_ID}`).click();
    await confirmDialog(page, 'İşi tekrar dene', { reason: REASON });
    await expect(page.getByText('İş kuyruğa alındı.').first()).toBeVisible();
    const call = (await mockCalls(request)).find((c) => c.path === `/jobs/${DEAD_JOB_ID}/retry`);
    expect(call?.body).toMatchObject({ reason: REASON, confirm: true, reset_attempts: false });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kuyrukta');
  });

  test('a running job cannot be cancelled and says why', async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto(`/jobs/${RUNNING_JOB_ID}`);
    const cancel = page.getByTestId(`cancel-${RUNNING_JOB_ID}`);
    await expect(cancel).toBeDisabled();
    await expect(page.getByText('Çalışan iş iptal edilemez.').first()).toBeAttached();
  });

  test("today's failed briefing is regenerated from Briefings", async ({ page, request }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/briefings?f.status=failed');
    const regenerate = page.getByTestId(`regenerate-${FAILED_BRIEFING_ID}`);
    await expect(regenerate).toBeEnabled();
    await regenerate.click();
    await confirmDialog(page, 'Brifingi yeniden oluştur', { reason: REASON });
    await expect(page.getByText('Brifing işi kuyruğa alındı.').first()).toBeVisible();
    const state = (await (await request.get(`${MOCK_ORIGIN}/__mock/state`)).json()) as {
      audit: { action: string }[];
    };
    expect(state.audit.at(-1)?.action).toBe('briefing.regenerated');
  });
});
