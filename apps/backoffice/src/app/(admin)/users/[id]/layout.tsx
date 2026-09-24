import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { ReadError } from '@/components/module-kit';
import { StatusBadge } from '@/components/status-badge';
import { hasAnyPermission } from '@/lib/admin-context';
import { loadAdminContext } from '@/server/session';
import { userDevices, userIdFrom, userOverview, userSupport } from './data';
import { SupportAccessBanner } from './support-access-banner';
import { UserActions } from './user-actions';
import { UserIdentity } from './user-identity';
import { UserTabs } from './user-tabs';

/*
 * User detail shell (BACKOFFICE_PLAN §6.3; M§49, M§51; T-10.06): the shared header (masked
 * identity with an audited reveal, full id, plan and state badges, "Destek erişimi aktif"), the
 * "İşlemler" menu rendered by permission, the Support Access banner for this admin's active grant,
 * and the eight tabs. No impersonation or "login as user" exists anywhere (M§49).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.userDetail');
  return { title: t('title') };
}

export default async function UserLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const id = await userIdFrom(params);
  const [t, context, overview] = await Promise.all([
    getTranslations('backoffice.userDetail'),
    loadAdminContext(),
    userOverview(id),
  ]);
  const can = (...permissions: string[]) => hasAnyPermission(context.permissions, permissions);

  if (!overview.ok) {
    return (
      <>
        <h1 className="text-bo-page-title text-ink">{t('title')}</h1>
        <Card>
          <ReadError error={overview.error} backHref="/users" />
        </Card>
      </>
    );
  }

  const [support, devices] = await Promise.all([
    can('support.read') ? userSupport(id) : Promise.resolve(null),
    can('notifications.read') && can('push.test') ? userDevices(id) : Promise.resolve(null),
  ]);
  const grants = support?.ok === true ? support.data.access_grants : [];
  const myActiveGrant = grants.find((g) => g.active && g.admin.id === context.admin.id) ?? null;
  const anyActiveGrant = grants.some((g) => g.active);
  const tickets = support?.ok === true ? support.data.tickets : [];

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-bo-page-title text-ink">{t('title')}</h1>
          <UserIdentity userId={id} />
          <div className="flex flex-wrap items-center gap-2" aria-label={t('badges')}>
            <StatusBadge group="plan" value={overview.data.plan} />
            <StatusBadge group="userState" value={overview.data.account_status} />
            {anyActiveGrant ? (
              <span className="rounded-pill bg-tone-warning-soft px-2 py-0.5 text-badge text-tone-warning-text uppercase">
                {t('supportAccessActive')}
              </span>
            ) : null}
          </div>
        </div>
        <UserActions
          userId={id}
          status={overview.data.account_status}
          devices={devices?.ok === true ? devices.data : null}
          tickets={tickets.filter((ticket) => ticket.status !== 'closed')}
          hasActiveGrant={myActiveGrant !== null}
        />
      </header>
      {myActiveGrant === null ? null : <SupportAccessBanner userId={id} grant={myActiveGrant} />}
      <UserTabs userId={id} />
      {children}
    </>
  );
}
