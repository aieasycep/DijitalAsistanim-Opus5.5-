'use client';

import type { UserBriefingRow } from '@da/validation/admin/users';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { RegenerateBriefing } from '@/components/regenerate-briefing';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof UserBriefingRow>;

export function UserBriefingsTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.briefings');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('user.briefings');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'kind',
      header: t('columns.kind'),
      required: true,
      cell: (row) => <EnumLabel group="briefingKind" value={row.kind} />,
    },
    {
      id: 'local_date',
      header: t('columns.localDate'),
      sortable: true,
      cell: (row) => f.localDate(row.local_date),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="briefingStatus" value={row.status} />,
    },
    {
      id: 'scheduled_for',
      header: t('columns.scheduled'),
      sortable: true,
      cell: (row) => f.dateTime(row.scheduled_for),
    },
    {
      id: 'generated_at',
      header: t('columns.generated'),
      cell: (row) => f.dateTime(row.generated_at),
    },
    {
      id: 'delivered_at',
      header: t('columns.delivered'),
      cell: (row) => f.dateTime(row.delivered_at),
    },
    {
      id: 'latency',
      header: t('columns.latency'),
      align: 'end',
      cell: (row) => f.duration(row.latency_ms),
    },
    {
      id: 'items',
      header: t('columns.items'),
      align: 'end',
      cell: (row) => f.number(row.item_count),
    },
    { id: 'cost', header: t('columns.cost'), align: 'end', cell: (row) => f.usd(row.ai_cost_usd) },
    {
      id: 'decision',
      header: t('columns.decision'),
      cell: (row) => <EnumLabel group="notificationDecision" value={row.notification_decision} />,
    },
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (row) => (
        <span className="font-mono text-bo-mono">{row.skip_reason ?? row.error_code ?? '—'}</span>
      ),
    },
  ];
  return (
    <DataTable<Row>
      tableId="user.briefings"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      emptyTitle={t('emptyUser')}
      rowActions={(row) => (
        <RegenerateBriefing briefingId={row.id} status={row.status} localDate={row.local_date} />
      )}
      actionsLabel={t('columns.actions')}
      filters={[
        {
          key: 'kind',
          label: t('filters.kind'),
          single: true,
          options: (['morning', 'midday', 'evening', 'weekly'] as const).map((value) => ({
            value,
            label: label('briefingKind', value),
          })),
        },
        {
          key: 'status',
          label: t('filters.status'),
          single: true,
          options: (
            ['scheduled', 'generating', 'ready', 'delivered', 'skipped', 'failed'] as const
          ).map((value) => ({ value, label: label('briefingStatus', value) })),
        },
        { key: 'from', label: t('filters.from'), kind: 'date', options: [] },
        { key: 'to', label: t('filters.to'), kind: 'date', options: [] },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
