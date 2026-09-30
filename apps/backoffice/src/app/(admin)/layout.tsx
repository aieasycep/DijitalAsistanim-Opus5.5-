import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AdminProvider } from '@/components/admin-provider';
import { CommandPaletteProvider } from '@/components/command-palette';
import { RouteMetaProvider } from '@/components/route-meta';
import { SessionActionsProvider } from '@/components/session-actions';
import { SessionWatcher } from '@/components/session-watcher';
import { Sidebar } from '@/components/sidebar';
import { OfflineBanner } from '@/components/states/offline-banner';
import { Topbar } from '@/components/topbar';
import { serverEnv } from '@/env';
import { remainingMs } from '@/lib/admin-context';
import { visibleNavigation } from '@/lib/navigation';
import { moduleConfirmations } from '@/server/admin-contracts';
import { THEME_COOKIE, parseTheme } from '@/server/preference-cookies';
import { loadAdminContext } from '@/server/session';

/*
 * Admin shell (BACKOFFICE_PLAN §2.2 `(admin)/layout.tsx`): requires the admin context from
 * `GET /me` (session failures redirect to /login or /mfa), then renders the sidebar, topbar, command
 * palette and SessionWatcher. Navigation is filtered by permission (cosmetic) and by the modules
 * that exist.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [context, t, store] = await Promise.all([
    loadAdminContext(),
    getTranslations('backoffice'),
    cookies(),
  ]);
  const groups = visibleNavigation(context.permissions);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  return (
    <AdminProvider value={context}>
      <RouteMetaProvider value={moduleConfirmations()}>
        <SessionActionsProvider>
          <CommandPaletteProvider
            groups={groups}
            canSearch={context.permissions.includes('search.global')}
            theme={theme}
          >
            <a
              href="#main"
              className="sr-only z-50 rounded-tile bg-surface px-4 py-2 text-bo-body font-semibold text-ink shadow-modal focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
            >
              {t('app.skipToContent')}
            </a>
            <div className="flex min-h-dvh">
              <Sidebar groups={groups} collapsed={context.preferences.sidebar_collapsed} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Topbar groups={groups} appEnv={serverEnv().APP_ENV} theme={theme} />
                <OfflineBanner />
                <main
                  id="main"
                  tabIndex={-1}
                  className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 p-4 outline-none sm:p-6"
                >
                  {children}
                </main>
              </div>
            </div>
            <SessionWatcher
              idleRemainingMs={remainingMs(
                context.session.idleExpiresAt,
                context.session.serverTime,
              )}
              absoluteRemainingMs={remainingMs(
                context.session.absoluteExpiresAt,
                context.session.serverTime,
              )}
            />
          </CommandPaletteProvider>
        </SessionActionsProvider>
      </RouteMetaProvider>
    </AdminProvider>
  );
}
