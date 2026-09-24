'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { setSidebarCollapsedAction } from '@/actions/preferences';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { NavGroup } from '@/lib/navigation';

/*
 * Sidebar (BACKOFFICE_PLAN §5.2, M§46): the groups and items in the exact plan order, already
 * filtered on the server by permission (cosmetic) and by module availability (no dead links).
 * 248 px, collapsible to 64 px (remembered in admin preferences); the active item uses the
 * primary-soft background and the filled icon.
 */

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavList({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('backoffice.nav');
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`nav-group-${group.key}`}
          className="flex flex-col gap-1"
        >
          <h2
            id={`nav-group-${group.key}`}
            className={cn('px-3 text-bo-kicker text-ink-3 uppercase', collapsed && 'sr-only')}
          >
            {t(`groups.${group.key}`)}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? t(`items.${item.key}`) : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'flex min-h-10 items-center gap-3 rounded-tile px-3 text-bo-body font-medium text-ink-2 outline-none hover:bg-surface-pressed hover:text-ink focus-visible:ring-2 focus-visible:ring-border-focus',
                      active &&
                        'bg-primary-soft text-on-soft hover:bg-primary-soft hover:text-on-soft',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <Icon name={item.icon} filled={active} />
                    <span className={cn(collapsed && 'sr-only')}>{t(`items.${item.key}`)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Sidebar({
  groups,
  collapsed: initialCollapsed,
}: {
  groups: readonly NavGroup[];
  collapsed: boolean;
}) {
  const t = useTranslations('backoffice');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [, startTransition] = useTransition();
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-hairline bg-surface-sunken p-3 lg:flex',
        collapsed ? 'w-16' : 'w-62',
      )}
    >
      <div
        className={cn(
          'flex min-h-10 items-center gap-2',
          collapsed ? 'justify-center' : 'justify-between px-2',
        )}
      >
        {collapsed ? null : (
          <Link
            href="/dashboard"
            aria-label={t('app.homeLink')}
            className="truncate text-bo-section text-ink"
          >
            {t('app.name')}
          </Link>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            startTransition(async () => {
              await setSidebarCollapsedAction(next);
            });
          }}
        >
          <Icon name="menu" />
        </Button>
      </div>
      <nav aria-label={t('nav.label')}>
        <NavList groups={groups} collapsed={collapsed} />
      </nav>
    </aside>
  );
}
