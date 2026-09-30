'use client';

import type { AdminNotificationRow } from '@da/validation/admin/briefings';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AdminNotificationRow>;

const CATEGORIES = [
  'morning',
  'midday',
  'evening',
  'critical_email',
  'meeting',
  'deadline',
  'follow_up',
  'life_intel',
  'approval',
  'account',
] as const;

export function NotificationsTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.notifications');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('notifications');
  const reason = (key: string | null) =>
    key === null ? '—' : t.has(`reasons.${key}` as never) ? t(`reasons.${key}` as never) : key;
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.id.slice(0, 8)}</span>,
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (row) => <EnumLabel group="notificationCategory" value={row.category} />,
    },
    {
      id: 'decision',
      header: t('columns.decision'),
      cell: (row) => <StatusBadge group="notificationDecision" value={row.decision} />,
    },
    { id: 'reason', header: t('columns.reason'), cell: (row) => reason(row.decision_reason) },
    {
      id: 'detail',
      header: t('columns.detail'),
      cell: (row) => <EnumLabel group="notificationDetail" value={row.detail_mode} />,
    },
    {
      id: 'sent_at',
      header: t('columns.sent'),
      sortable: true,
      cell: (row) => f.dateTime(row.sent_at),
    },
    {
      id: 'receipt',
      header: t('columns.receipt'),
      cell: (row) => <span className="font-mono">{row.receipt_status ?? '—'}</span>,
    },
  ];
  return (
    <DataTable<Row>
      tableId="notifications"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'category',
          label: t('filters.category'),
          single: true,
          options: CATEGORIES.map((value) => ({
            value,
            label: label('notificationCategory', value),
          })),
        },
        {
          key: 'decision',
          label: t('filters.decision'),
          single: true,
          options: (['scheduled', 'sent', 'suppressed', 'deduplicated', 'failed'] as const).map(
            (value) => ({
              value,
              label: label('notificationDecision', value),
            }),
          ),
        },
        {
          key: 'user_id',
          label: t('filters.user'),
          kind: 'text',
          pattern: '^[0-9a-fA-F-]{36}$',
          options: [],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
