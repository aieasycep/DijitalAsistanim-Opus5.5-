import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { resetMock, signIn, signInAs, watchCsp } from './helpers';

/* BO-E2E-34 (contract tier, T-10.02…T-10.15 surfaces): axe on every built route, light and dark. */

const USER = '/users/0190f5e0-1111-7000-8000-00000000abcd';
/** Every module page with its h1 (super_admin sees them all). */
const ROUTES: readonly [string, string][] = [
  ['/users', 'Kullanıcılar'],
  [`${USER}/overview`, 'Kullanıcı ayrıntısı'],
  [`${USER}/integrations`, 'Kullanıcı ayrıntısı'],
  [`${USER}/briefings`, 'Kullanıcı ayrıntısı'],
  [`${USER}/usage`, 'Kullanıcı ayrıntısı'],
  [`${USER}/subscription`, 'Kullanıcı ayrıntısı'],
  [`${USER}/referrals`, 'Kullanıcı ayrıntısı'],
  [`${USER}/support`, 'Kullanıcı ayrıntısı'],
  [`${USER}/audit`, 'Kullanıcı ayrıntısı'],
  ['/support', 'Destek'],
  ['/support/0190f5e0-8888-7000-8000-000000000001', 'Gmail hesabım senkron olmuyor'],
  ['/integrations', 'Entegrasyonlar'],
  ['/jobs', 'Senkron ve İşler'],
  ['/jobs/0190f5e0-4444-7000-8000-000000000001', 'Gmail senkronu'],
  ['/briefings', 'Brifingler'],
  ['/notifications', 'Bildirimler'],
  ['/ai', 'AI Operasyonları'],
  ['/ai/models', 'AI Operasyonları'],
  ['/ai/feedback', 'AI Geri Bildirimi'],
  ['/ai/prompts', 'Prompt Yönetimi'],
  ['/ai/prompts/briefing_morning', 'briefing_morning'],
  ['/subscriptions', 'Abonelikler'],
  ['/referrals', 'Davetler'],
  ['/feedback', 'Geri Bildirim'],
  ['/flags', 'Özellik Bayrakları'],
  ['/announcements', 'Duyurular'],
  ['/data-requests', 'Veri talepleri'],
  ['/audit', 'Denetim'],
  ['/health', 'Sistem sağlığı'],
  ['/admins', 'Yöneticiler'],
  ['/settings', 'Ayarlar'],
];

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

  test('every module page renders its data and passes axe', async ({ page, request }) => {
    test.setTimeout(240_000);
    await signInAs(page, request, 'super_admin');
    const csp = await watchCsp(page);
    // A missing translation or a runtime error in a client island logs to the console.
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !/Content Security Policy|Refused to/.test(message.text())
      ) {
        consoleErrors.push(`${page.url()}: ${message.text()}`);
      }
    });
    for (const [route, heading] of ROUTES) {
      await page.goto(route);
      await expect
        .soft(page.getByRole('heading', { level: 1, name: heading }), route)
        .toBeVisible();
      await expect.soft(page.getByText('Veriler yüklenemedi.'), route).toHaveCount(0);
      await expect.soft(page.getByText('Yükleniyor', { exact: true }), route).toHaveCount(0);
      expect.soft(await violations(page), route).toEqual([]);
    }
    await page.getByRole('button', { name: 'Koyu temaya geç' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const route of [
      '/users',
      `${USER}/overview`,
      '/ai',
      '/flags',
      '/health',
      '/announcements',
    ]) {
      await page.goto(route);
      await expect.soft(page.getByText('Veriler yüklenemedi.'), route).toHaveCount(0);
      expect.soft(await violations(page), `${route} (dark)`).toEqual([]);
    }
    expect(await csp()).toEqual([]);
    expect(consoleErrors).toEqual([]);
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
