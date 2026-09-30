import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADMIN_ROLE_VALUES, ROLE_PERMISSIONS } from '@da/domain';
import { loadMessages } from '@da/i18n';
import { describe, expect, it } from 'vitest';

import {
  BUILT_ROUTES,
  NAVIGATION,
  activeNavItem,
  isBuiltPath,
  visibleNavigation,
} from '../navigation';

const ADMIN_APP = fileURLToPath(new URL('../../app/(admin)', import.meta.url));
const ALL_ROUTES = new Set<string>(NAVIGATION.flatMap((g) => g.items.map((i) => i.href)));

/** Every `/route` under `src/app/(admin)` that has a `page.tsx`. */
function pagesOnDisk(dir = ADMIN_APP, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const route = `${prefix}/${name}`;
    if (existsSync(join(full, 'page.tsx'))) found.push(route);
    found.push(...pagesOnDisk(full, route));
  }
  return found;
}

describe('sidebar IA (BACKOFFICE_PLAN §5.2, M§46)', () => {
  it('has the exact groups, items and order of the plan', () => {
    expect(NAVIGATION.map((g) => [g.key, g.items.map((i) => `${i.key}:${i.href}`)])).toEqual([
      ['overview', ['dashboard:/dashboard']],
      ['users', ['users:/users', 'support:/support']],
      [
        'operations',
        [
          'integrations:/integrations',
          'jobs:/jobs',
          'briefings:/briefings',
          'notifications:/notifications',
        ],
      ],
      ['ai', ['aiOperations:/ai', 'prompts:/ai/prompts']],
      ['business', ['subscriptions:/subscriptions', 'referrals:/referrals']],
      ['product', ['feedback:/feedback', 'flags:/flags', 'announcements:/announcements']],
      ['privacy', ['dataRequests:/data-requests', 'audit:/audit']],
      ['system', ['health:/health', 'admins:/admins', 'settings:/settings']],
    ]);
  });

  it('labels every group and item in Turkish and English (M§46 English names)', () => {
    const tr = loadMessages('tr').backoffice.nav;
    const en = loadMessages('en').backoffice.nav;
    expect(NAVIGATION.map((g) => tr.groups[g.key])).toEqual([
      'Genel Bakış',
      'Kullanıcılar',
      'Operasyon',
      'Yapay Zekâ',
      'İş',
      'Ürün',
      'Gizlilik',
      'Sistem',
    ]);
    expect(NAVIGATION.flatMap((g) => g.items.map((i) => en.items[i.key]))).toEqual([
      'Dashboard',
      'Users',
      'Support',
      'Integrations',
      'Sync & Jobs',
      'Briefings',
      'Notifications',
      'AI Operations',
      'Prompt Management',
      'Subscriptions',
      'Referrals',
      'Feedback',
      'Feature Flags',
      'Announcements',
      'Data Requests',
      'Audit Logs',
      'System Health',
      'Admin Users',
      'Settings',
    ]);
  });

  it('filters by "visible if any of" for every role (§4.2)', () => {
    const visible = Object.fromEntries(
      ADMIN_ROLE_VALUES.map((role) => [
        role,
        visibleNavigation(ROLE_PERMISSIONS[role], ALL_ROUTES).flatMap((g) =>
          g.items.map((i) => i.key),
        ),
      ]),
    );
    expect(visible.super_admin).toHaveLength(19);
    expect(visible.analyst).toEqual([
      'dashboard',
      'jobs',
      'briefings',
      'notifications',
      'aiOperations',
      'subscriptions',
      'referrals',
      'settings',
    ]);
    expect(visible.finance).toEqual([
      'dashboard',
      'users',
      'subscriptions',
      'referrals',
      'health',
      'settings',
    ]);
    expect(visible.ai_ops).toEqual([
      'dashboard',
      'jobs',
      'briefings',
      'notifications',
      'aiOperations',
      'prompts',
      'feedback',
      'flags',
      'health',
      'settings',
    ]);
    expect(visible.support).not.toContain('admins');
    expect(visible.operations).toHaveLength(19);
    expect(visible.readonly).toContain('admins');
  });

  it('never links to a module page that does not exist (no dead links)', () => {
    const onDisk = new Set(pagesOnDisk().filter((route) => ALL_ROUTES.has(route)));
    expect([...BUILT_ROUTES].sort()).toEqual([...onDisk].sort());
    for (const role of ADMIN_ROLE_VALUES) {
      for (const group of visibleNavigation(ROLE_PERMISSIONS[role])) {
        for (const item of group.items)
          expect(onDisk.has(item.href), `${role} ${item.href}`).toBe(true);
      }
    }
  });

  it('finds the active entry and whether a palette route is built', () => {
    expect(activeNavItem('/ai/prompts/briefing_morning')?.item.key).toBe('prompts');
    expect(activeNavItem('/ai')?.item.key).toBe('aiOperations');
    expect(activeNavItem('/nowhere')).toBeNull();
    expect(isBuiltPath('/dashboard?range=7d')).toBe(true);
    expect(isBuiltPath('/users/0190f5e0-1111-7000-8000-00000000abcd')).toBe(true);
    expect(isBuiltPath('/nowhere')).toBe(false);
  });
});
