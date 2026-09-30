'use client';

import type { IntegrationRow } from '@da/validation/admin/integrations';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof IntegrationRow>;

const STATUSES = [
  'connecting',
  'healthy',
  'syncing',
  'partial',
  'needs_reauth',
  'admin_consent_required',
  'error',
  'disconnected',
] as const;

export function IntegrationsTable({
  data,
  selectedId,
}: {
  data: TableData<Row>;
  selectedId?: string;
}) {
  const t = useTranslations('backoffice.integrations');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('integrations');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'account',
      header: t('columns.account'),
      required: true,
      cell: (row) => <span className="font-mono">{row.account_id.slice(0, 8)}</span>,
    },
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) => (
        <Link
          href={`/users/${row.user_id}/integrations`}
          className="font-mono text-text-link hover:underline"
        >
          {row.user_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: 'provider',
      header: t('columns.provider'),
      sortable: true,
      cell: (row) => <EnumLabel group="provider" value={row.provider} />,
    },
    { id: 'email', header: t('columns.email'), cell: (row) => row.email_masked ?? '—' },
    {
      id: 'status',
      header: t('columns.status'),
      sortable: true,
      cell: (row) => <StatusBadge group="accountStatus" value={row.status} />,
    },
    {
      id: 'error',
      header: t('columns.error'),
      cell: (row) => <span className="font-mono">{row.last_error_code ?? '—'}</span>,
    },
    {
      id: 'last_sync_at',
      header: t('columns.lastSync'),
      sortable: true,
      cell: (row) => f.dateTime(row.last_sync_at),
    },
    { id: 'watch', header: t('columns.watch'), cell: (row) => f.dateTime(row.watch_expires_at) },
    {
      id: 'key_version',
      header: t('columns.keyVersion'),
      align: 'end',
      cell: (row) => (row.key_version === null ? '—' : f.number(row.key_version)),
    },
  ];
  return (
    <DataTable<Row>
      tableId="integrations"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.account_id}
      rowHref={(row) => `/integrations?account=${row.account_id}`}
      {...(selectedId === undefined ? {} : { selectedRowId: selectedId })}
      searchable
      searchPattern="^[0-9a-fA-F-]{8,36}$"
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'provider',
          label: t('filters.provider'),
          single: true,
          options: (['google', 'microsoft', 'apple_device', 'android_device'] as const).map(
            (value) => ({
              value,
              label: label('provider', value),
            }),
          ),
        },
        {
          key: 'status',
          label: t('filters.status'),
          single: true,
          options: STATUSES.map((value) => ({ value, label: label('accountStatus', value) })),
        },
        {
          key: 'issue',
          label: t('filters.issue'),
          single: true,
          options: (
            ['needs_reconnect', 'oauth_error', 'refresh_error', 'watch_issue'] as const
          ).map((value) => ({
            value,
            label: label('integrationIssue', value),
          })),
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
