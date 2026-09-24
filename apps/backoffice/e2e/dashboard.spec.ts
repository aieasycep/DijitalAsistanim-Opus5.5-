import { expect, test } from '@playwright/test';

import { mockCalls, signInAs, watchCsp } from './helpers';

/* BO-E2E-01 (contract tier): the dashboard KPIs, charts, panels and range control. */

test.describe('dashboard', () => {
  test('shows KPIs, charts and the system status from admin-api', async ({ page, request }) => {
    const csp = await watchCsp(page);
    await signInAs(page, request, 'operations');
    await expect(page.getByTestId('kpi-total_users').first()).toContainText('12.480');
    await expect(page.getByTestId('kpi-ai_cost_usd').first()).toBeVisible();
    await expect(page.getByTestId('chart-ai_costs').first()).toBeVisible();
    await expect(page.getByTestId('system-overall').first()).toContainText('Kısmi sorun');

    await page.getByRole('radio', { name: '30 gün' }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(page.getByTestId('kpi-total_users').first()).toBeVisible();
    const ranges = (await mockCalls(request))
      .filter((c) => c.path === '/dashboard/metrics')
      .map((c) => c.method);
    expect(ranges.length).toBeGreaterThan(1);
    expect(await csp()).toEqual([]);
  });
});
