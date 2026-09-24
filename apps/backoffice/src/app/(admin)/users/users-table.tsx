'use client';

import type { UserRow } from '@da/validation/admin/users';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';
import { USER_ID_SEARCH } from './config';

type Row = z.infer<typeof UserRow>;

/** Users table (§6.2): masked rows, M§51 columns; the first cell links to the user's overview. */
export function UsersTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.users');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('users');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'user',
      header: t('columns.user'),
      required: true,
      cell: (row) => <span className="font-mono text-bo-mono">{row.id.slice(0, 8)}</span>,
    },
    { id: 'email', header: t('columns.email'), cell: (row) => row.email_masked },
    {
      id: 'plan',
      header: t('columns.plan'),
      cell: (row) => <StatusBadge group="plan" value={row.plan} />,
    },
    {
      id: 'created_at',
      header: t('columns.createdAt'),
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
    {
      id: 'last_active_at',
      header: t('columns.lastActive'),
      sortable: true,
      cell: (row) => f.dateTime(row.last_active_at),
    },
    {
      id: 'platform',
      header: t('columns.platform'),
      cell: (row) => label('platform', row.platform),
    },
    {
      id: 'connected_accounts',
      header: t('columns.accounts'),
      align: 'end',
      cell: (row) => f.number(row.connected_accounts),
    },
    {
      id: 'last_sync_at',
      header: t('columns.lastSync'),
      sortable: true,
      cell: (row) => f.dateTime(row.last_sync_at),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="userState" value={row.status} />,
    },
  ];
  return (
    <DataTable<Row>
      tableId="users"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/users/${row.id}/overview`}
      searchable
      searchPattern={USER_ID_SEARCH}
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'plan',
          label: t('filters.plan'),
          single: true,
          options: (['free', 'pro', 'trial'] as const).map((value) => ({
            value,
            label: label('plan', value),
          })),
        },
        {
          key: 'state',
          label: t('filters.state'),
          single: true,
          options: (['inactive', 'sync_error', 'connection_error', 'disabled'] as const).map(
            (value) => ({ value, label: label('userIssue', value) }),
          ),
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
