import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { PageHeader } from '@/components/page-header';
import { toTableData } from '@/lib/read-result';
import { readAdmin } from '@/server/read';
import { USER_FILTERS, USER_SORTS } from './config';
import { EmailLookup } from './email-lookup';
import { UsersTable } from './users-table';

/*
 * Users (BACKOFFICE_PLAN §6.2, M§51; T-10.06): server-paginated `GET /users` with the plan and
 * state filters, identifier search (`q`: user id or an id prefix of at least 8 hex characters) and
 * the exact email lookup, which goes through a POST body (`/users/lookup`) and never the URL. Rows
 * are masked in SQL; reveal lives on the user detail page.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.users');
  return { title: t('title') };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.users'), searchParams]);
  const state = loadTableState(params, USER_FILTERS);
  const result = await readAdmin('GET /users', {
    query: toAdminListQuery(state, {
      sortable: USER_SORTS,
      filterKeys: USER_FILTERS,
      transform: { plan: firstValue, state: firstValue },
    }),
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={<EmailLookup />} />
      <UsersTable data={toTableData(result)} />
    </>
  );
}
