import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { loadTableState } from '@/components/data-table/url-state';
import { ReadError } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { pageOf } from '@/lib/read-result';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { AdminsTable, InviteAdminButton } from './admins-table';

/*
 * Yöneticiler (BACKOFFICE_PLAN §6.23, §4.4; M§68; R-08; T-10.14): dedicated admin identities with
 * role, status, last login and MFA state. `admins.manage` (super_admin, step-up) invites, changes
 * roles, disables / re-enables, resets MFA, revokes sessions, resends invites and unlocks. The last
 * active super_admin and the admin's own account cannot be changed here (the database enforces it;
 * the controls explain why). An address that belongs to an app user can never become an admin.
 */

const FILTERS = ['role', 'status', 'mfa'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.admins');
  return { title: t('title') };
}

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context, result] = await Promise.all([
    getTranslations('backoffice.admins'),
    searchParams,
    loadAdminContext(),
    readAdmin('GET /admins'),
  ]);
  const state = loadTableState(params, FILTERS);
  const role = state['f.role']?.[0];
  const status = state['f.status']?.[0];
  const mfa = state['f.mfa']?.[0];
  const all = result.ok ? result.data : [];
  const filtered = all
    .filter((row) => role === undefined || row.role === role)
    .filter((row) => status === undefined || row.status === status)
    .filter((row) => mfa === undefined || (mfa === 'enrolled') === row.mfa_enrolled);
  const sorted = [...filtered].sort((a, b) =>
    state.sort === 'last_login_at'
      ? (Date.parse(a.last_login_at ?? '0') - Date.parse(b.last_login_at ?? '0')) *
        (state.order === 'asc' ? 1 : -1)
      : a.email.localeCompare(b.email) * (state.order === 'asc' ? 1 : -1),
  );
  const page = pageOf(sorted, state.page, [25, 50, 100].includes(state.size) ? state.size : 25);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={context.permissions.includes('admins.manage') ? <InviteAdminButton /> : undefined}
      />
      {result.ok ? (
        <AdminsTable rows={page.rows} total={page.total} all={all} selfId={context.admin.id} />
      ) : (
        <Card>
          <ReadError error={result.error} />
        </Card>
      )}
    </>
  );
}
