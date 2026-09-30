import { ADMIN_ROLE_VALUES, ROLE_PERMISSIONS } from '@da/domain';
import { expect, test } from '@playwright/test';

import { visibleNavigation } from '../src/lib/navigation';
import { mockAudit, signInAs } from './helpers';

/*
 * BO-E2E-27 (contract tier, BACKOFFICE_PLAN §4.3): for every role the sidebar shows exactly the
 * permitted modules, and a module opened by URL without permission renders the forbidden state
 * while admin-api refuses the read and writes `admin.permission_denied`.
 */

/** A module each role may not read (its primary read is refused by admin-api). */
const DENIED: Partial<Record<(typeof ADMIN_ROLE_VALUES)[number], string>> = {
  operations: '/settings?tab=system',
  support: '/admins',
  finance: '/jobs',
  ai_ops: '/users',
  analyst: '/users',
  readonly: '/jobs?f.status=dead_letter',
};

test.describe('RBAC matrix', () => {
  for (const role of ADMIN_ROLE_VALUES) {
    test(`${role}: sidebar and direct URL access follow the permissions`, async ({
      page,
      request,
    }) => {
      await signInAs(page, request, role);
      const menu = page.getByRole('navigation', { name: 'Ana menü' });
      const expected = visibleNavigation(ROLE_PERMISSIONS[role]).flatMap((group) =>
        group.items.map((item) => item.href),
      );
      const hrefs = await menu
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(hrefs).toEqual(expected);

      const denied = DENIED[role];
      if (denied === undefined) return;
      const deniedRows = async () =>
        (await mockAudit(request)).filter((a) => a.action === 'admin.permission_denied').length;
      const before = await deniedRows();
      await page.goto(denied);
      if (denied.startsWith('/settings')) {
        // Readable by every admin; the write controls need `settings.system.write`.
        await expect(page.getByTestId('app-settings').first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Düzenle' })).toHaveCount(0);
        return;
      }
      if (role === 'readonly') {
        // Reads everything, changes nothing: no retry control is rendered.
        await expect(page.getByRole('table').first()).toBeVisible();
        await expect(page.locator('[data-testid^="retry-"]')).toHaveCount(0);
        return;
      }
      await expect(page.getByText('Bu bölümü görüntüleme yetkin yok.').first()).toBeVisible();
      expect(await deniedRows()).toBeGreaterThan(before);
    });
  }
});
