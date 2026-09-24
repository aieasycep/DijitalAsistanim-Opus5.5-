import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { resetMock, signIn, watchCsp } from './helpers';

/* BO-E2E-34 (contract tier, T-10.02…T-10.04 surfaces): axe on every built route, light and dark. */

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

test.describe('accessibility', () => {
  test('sign-in screens have no axe violations', async ({ page, request }) => {
    await resetMock(request);
    await page.goto('/login');
    expect(await violations(page)).toEqual([]);
    await page.goto('/invite?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(await violations(page)).toEqual([]);
    await page.goto('/forbidden');
    expect(await violations(page)).toEqual([]);
  });

  test('the admin shell, dashboard and palette pass axe in light and dark', async ({
    page,
    request,
  }) => {
    await resetMock(request, { enrolled: true });
    const csp = await watchCsp(page);
    await signIn(page, { enrolled: true });
    await expect(page.getByTestId('kpi-total_users')).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Koyu temaya geç' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await violations(page)).toEqual([]);

    // The theme is persisted: a reload renders dark on the server.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Komut paleti' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    expect(await csp()).toEqual([]);
  });

  test('keyboard only: skip link and sidebar navigation', async ({ page, request }) => {
    await resetMock(request, { enrolled: true });
    await signIn(page, { enrolled: true });
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
