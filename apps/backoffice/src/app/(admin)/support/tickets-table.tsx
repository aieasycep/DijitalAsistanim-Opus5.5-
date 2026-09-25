'use client';

import type { TicketRow } from '@da/validation/admin/support';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { useAdmin } from '@/components/admin-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof TicketRow>;

const STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'] as const;
const CATEGORIES = [
  'account',
  'integration',
  'sync',
  'billing',
  'ai_quality',
  'notification',
  'privacy',
  'other',
] as const;

export function TicketsTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.support');
  const label = useEnumLabel();
  const f = useFormatters();
  const admin = useAdmin();
  const table = useTablePrefs('support.tickets');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'reference',
      header: t('columns.reference'),
      required: true,
      cell: (row) => <span className="font-mono">{row.reference}</span>,
    },
    {
      id: 'subject',
      header: t('columns.subject'),
      cell: (row) => <span className="line-clamp-1 max-w-80">{row.subject}</span>,
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (row) => <EnumLabel group="ticketCategory" value={row.category} />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      sortable: true,
      cell: (row) => <StatusBadge group="ticketStatus" value={row.status} />,
    },
    {
      id: 'platform',
      header: t('columns.platform'),
      cell: (row) =>
        row.platform === null
          ? '—'
          : `${label('platform', row.platform)}${row.app_version === null ? '' : ` · ${row.app_version}`}`,
    },
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) =>
        row.user_id === null ? (
          t('webNoMatch')
        ) : (
          <Link
            href={`/users/${row.user_id}/overview`}
            className="font-mono text-text-link hover:underline"
            data-testid={`ticket-user-${row.id}`}
          >
            {row.user_id.slice(0, 8)}
          </Link>
        ),
    },
    {
      id: 'contact',
      header: t('columns.contact'),
      cell: (row) => row.contact_email_masked ?? t('webNoMatch'),
    },
    {
      id: 'assignee',
      header: t('columns.assignee'),
      cell: (row) => row.assignee ?? t('unassigned'),
    },
    {
      id: 'created_at',
      header: t('columns.created'),
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
  ];
  return (
    <DataTable<Row>
      tableId="support.tickets"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/support/${row.id}`}
      searchable
      searchPattern="^(DA-\d{4}-\d{6}|[0-9a-fA-F-]{8,36})$"
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'status',
          label: t('filters.status'),
          single: true,
          options: STATUSES.map((value) => ({ value, label: label('ticketStatus', value) })),
        },
        {
          key: 'category',
          label: t('filters.category'),
          single: true,
          options: CATEGORIES.map((value) => ({ value, label: label('ticketCategory', value) })),
        },
        {
          key: 'source',
          label: t('filters.source'),
          single: true,
          options: (['app', 'web'] as const).map((value) => ({
            value,
            label: label('ticketSource', value),
          })),
        },
        ...(admin === null
          ? []
          : [
              {
                key: 'assignee',
                label: t('filters.assignee'),
                single: true,
                options: [{ value: admin.admin.id, label: t('assignedToMe') }],
              },
            ]),
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
