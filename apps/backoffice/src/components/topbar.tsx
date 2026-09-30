'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import { useAdmin } from '@/components/admin-provider';
import { usePalette } from '@/components/command-palette';
import { Icon } from '@/components/icon';
import { useSessionActions } from '@/components/session-actions';
import { NavList } from '@/components/sidebar';
import { ThemeToggle, type Theme } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { activeNavItem, type NavGroup } from '@/lib/navigation';

/*
 * Topbar (BACKOFFICE_PLAN §5.1 "Topbar", 56 px): breadcrumb · "Ara… ⌘K" · theme toggle · environment
 * pill (anything but production shows "ÖNİZLEME") · account menu. Below 1024 px the sidebar becomes
 * a drawer opened from here.
 */

function subscribeNothing(): () => void {
  return () => undefined;
}

function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

export function Topbar({
  groups,
  appEnv,
  theme,
}: {
  groups: readonly NavGroup[];
  appEnv: string;
  theme: Theme;
}) {
  const t = useTranslations('backoffice');
  const pathname = usePathname();
  const palette = usePalette();
  const session = useSessionActions();
  const admin = useAdmin();
  const isMac = useIsMac();
  const [drawer, setDrawer] = useState(false);
  const current = activeNavItem(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-hairline bg-bg/95 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="iconSm"
        className="lg:hidden"
        aria-label={t('nav.open')}
        aria-expanded={drawer}
        onClick={() => {
          setDrawer(true);
        }}
      >
        <Icon name="menu" />
      </Button>
      <nav aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
        {current === null ? null : (
          <ol className="flex items-center gap-1 text-bo-body text-ink-2">
            <li className="hidden sm:block">{t(`nav.groups.${current.group.key}`)}</li>
            <li aria-hidden="true" className="hidden sm:block">
              <Icon name="chevron_right" size={16} className="text-ink-3" />
            </li>
            <li aria-current="page" className="truncate font-semibold text-ink">
              {t(`nav.items.${current.item.key}`)}
            </li>
          </ol>
        )}
      </nav>
      <button
        type="button"
        onClick={() => {
          palette.open();
        }}
        className="hidden h-9 min-w-56 items-center gap-2 rounded-tile border border-border-control bg-surface px-3 text-bo-body text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-border-focus md:flex"
      >
        <Icon name="search" size={16} />
        <span className="flex-1 text-left">{t('shell.search')}</span>
        <kbd className="rounded-[6px] bg-surface-sunken px-1.5 font-sans text-bo-meta text-ink-2">
          {isMac ? t('shell.searchShortcutMac') : t('shell.searchShortcutOther')}
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="iconSm"
        className="md:hidden"
        aria-label={t('shell.search')}
        onClick={() => {
          palette.open();
        }}
      >
        <Icon name="search" />
      </Button>
      {appEnv === 'production' ? null : <Badge tone="warning">{t('shell.envPreview')}</Badge>}
      <ThemeToggle initial={theme} />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('shell.accountMenu')}
            className="max-w-48"
          >
            <span className="flex size-7 items-center justify-center rounded-pill bg-primary-soft text-bo-meta font-semibold text-on-soft uppercase">
              {(admin?.admin.displayName ?? admin?.admin.email ?? '?').slice(0, 1)}
            </span>
            <span className="hidden truncate sm:inline">
              {admin?.admin.displayName ?? admin?.admin.email}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {admin === null ? null : (
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-bo-body font-semibold text-ink">
                {admin.admin.displayName ?? admin.admin.email}
              </span>
              <span className="truncate">{admin.admin.email}</span>
              <span>{t(`roles.${admin.admin.role}`)}</span>
            </DropdownMenuLabel>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              session.confirmLogout();
            }}
          >
            <Icon name="logout" size={16} />
            {t('auth.signOut')}
          </DropdownMenuItem>
          <DropdownMenuItem
            tone="destructive"
            onSelect={() => {
              session.confirmLogoutAll();
            }}
          >
            <Icon name="logout" size={16} />
            {t('auth.signOutAll')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        {drawer ? (
          <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-r-card p-4">
            <DialogTitle className="text-bo-section">{t('app.name')}</DialogTitle>
            <nav aria-label={t('nav.label')}>
              <NavList
                groups={groups}
                onNavigate={() => {
                  setDrawer(false);
                }}
              />
            </nav>
          </DialogContent>
        ) : null}
      </Dialog>
    </header>
  );
}
