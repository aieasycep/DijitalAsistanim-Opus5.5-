import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { PageHeader } from '@/components/page-header';
import { toTableData } from '@/lib/read-result';
import { readAdmin } from '@/server/read';
import { TicketsTable } from './tickets-table';

/*
 * Destek talepleri (BACKOFFICE_PLAN §6.4, M§62; T-10.07): server-paginated tickets with the M§62
 * statuses and categories, source and assignee filters and a ticket-reference search. The subject
 * and message were written to support by the user and are shown; contact emails stay masked.
 */

const FILTERS = ['status', 'category', 'source', 'assignee'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.support');
  return { title: t('title') };
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.support'), searchParams]);
  const state = loadTableState(params, FILTERS);
  const result = await readAdmin('GET /support/tickets', {
    query: toAdminListQuery(state, {
      sortable: ['created_at', 'status'],
      filterKeys: FILTERS,
      transform: {
        status: firstValue,
        category: firstValue,
        source: firstValue,
        assignee: firstValue,
      },
    }),
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TicketsTable data={toTableData(result)} />
    </>
  );
}
