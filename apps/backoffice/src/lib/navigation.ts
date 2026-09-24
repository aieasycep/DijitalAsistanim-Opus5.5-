import type { AdminPermission } from '@da/domain';
import type { Messages } from '@da/i18n/use-intl';

import type { IconName } from '@/generated/icons';
import { hasAnyPermission } from './admin-context';

/*
 * Sidebar information architecture: BACKOFFICE_PLAN §5.2 (M§46), in exact order, with the
 * "Visible if any of" permissions. Visibility by permission is cosmetic (§4.3 layer 1).
 *
 * No dead links: a module is shown only once its route exists in this app. `BUILT_ROUTES` lists
 * those routes and a unit test checks it against the `src/app/(admin)` pages on disk, so a module
 * task that adds a page also switches its sidebar entry on (and cannot forget to).
 */

type NavGroupKey = keyof Messages['backoffice']['nav']['groups'];
type NavItemKey = keyof Messages['backoffice']['nav']['items'];

export interface NavItem {
  readonly key: NavItemKey;
  readonly href: `/${string}`;
  readonly icon: IconName;
  readonly visibleIf: readonly AdminPermission[] | 'always';
}

export interface NavGroup {
  readonly key: NavGroupKey;
  readonly items: readonly NavItem[];
}

export const NAVIGATION: readonly NavGroup[] = [
  {
    key: 'overview',
    items: [
      {
        key: 'dashboard',
        href: '/dashboard',
        icon: 'space_dashboard',
        visibleIf: ['dashboard.read'],
      },
    ],
  },
  {
    key: 'users',
    items: [
      { key: 'users', href: '/users', icon: 'group', visibleIf: ['users.read'] },
      { key: 'support', href: '/support', icon: 'support_agent', visibleIf: ['support.read'] },
    ],
  },
  {
    key: 'operations',
    items: [
      { key: 'integrations', href: '/integrations', icon: 'hub', visibleIf: ['integrations.read'] },
      {
        key: 'jobs',
        href: '/jobs',
        icon: 'sync_alt',
        visibleIf: ['jobs.read', 'metrics.ops.read'],
      },
      {
        key: 'briefings',
        href: '/briefings',
        icon: 'wb_twilight',
        visibleIf: ['briefings.read', 'metrics.ops.read'],
      },
      {
        key: 'notifications',
        href: '/notifications',
        icon: 'notifications',
        visibleIf: ['notifications.read', 'metrics.ops.read'],
      },
    ],
  },
  {
    key: 'ai',
    items: [
      {
        key: 'aiOperations',
        href: '/ai',
        icon: 'smart_toy',
        visibleIf: ['ai.read', 'metrics.ai.read'],
      },
      {
        key: 'prompts',
        href: '/ai/prompts',
        icon: 'terminal',
        visibleIf: ['prompts.read', 'ai_feedback.read'],
      },
    ],
  },
  {
    key: 'business',
    items: [
      {
        key: 'subscriptions',
        href: '/subscriptions',
        icon: 'workspace_premium',
        visibleIf: ['subscriptions.read', 'metrics.revenue.read'],
      },
      {
        key: 'referrals',
        href: '/referrals',
        icon: 'redeem',
        visibleIf: ['referrals.read', 'metrics.product.read'],
      },
    ],
  },
  {
    key: 'product',
    items: [
      { key: 'feedback', href: '/feedback', icon: 'feedback', visibleIf: ['feedback.read'] },
      { key: 'flags', href: '/flags', icon: 'toggle_on', visibleIf: ['flags.read'] },
      {
        key: 'announcements',
        href: '/announcements',
        icon: 'campaign',
        visibleIf: ['announcements.read'],
      },
    ],
  },
  {
    key: 'privacy',
    items: [
      {
        key: 'dataRequests',
        href: '/data-requests',
        icon: 'policy',
        visibleIf: ['data_requests.read'],
      },
      { key: 'audit', href: '/audit', icon: 'history_edu', visibleIf: ['audit.read'] },
    ],
  },
  {
    key: 'system',
    items: [
      { key: 'health', href: '/health', icon: 'monitor_heart', visibleIf: ['health.read'] },
      { key: 'admins', href: '/admins', icon: 'admin_panel_settings', visibleIf: ['admins.read'] },
      { key: 'settings', href: '/settings', icon: 'settings', visibleIf: 'always' },
    ],
  },
];

/**
 * Module routes that exist in `src/app/(admin)`. Checked against the filesystem by
 * `src/lib/__tests__/navigation.test.ts`.
 */
export const BUILT_ROUTES: ReadonlySet<string> = new Set(
  NAVIGATION.flatMap((group) => group.items.map((item) => item.href)),
);

/** The groups and items this admin sees: permitted and built, empty groups dropped. */
export function visibleNavigation(
  permissions: readonly string[],
  built: ReadonlySet<string> = BUILT_ROUTES,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    key: group.key,
    items: group.items.filter(
      (item) => built.has(item.href) && hasAnyPermission(permissions, item.visibleIf),
    ),
  })).filter((group) => group.items.length > 0);
}

/** The nav entry that owns `pathname` (longest matching prefix), for breadcrumbs and highlighting. */
export function activeNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (best === null || item.href.length > best.item.href.length))
        best = { group, item };
    }
  }
  return best;
}

/** True when an in-app path (e.g. a palette search result route) belongs to a built module. */
export function isBuiltPath(path: string, built: ReadonlySet<string> = BUILT_ROUTES): boolean {
  const pathname = path.split(/[?#]/)[0] ?? path;
  for (const route of built) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return true;
  }
  return false;
}
