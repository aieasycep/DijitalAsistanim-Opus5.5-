'use client';

import type { AdminBriefingRow } from '@da/validation/admin/briefings';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { RegenerateBriefing } from '@/components/regenerate-briefing';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AdminBriefingRow>;

export function BriefingsTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.briefings');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('briefings');
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
      id: 'user',
      header: t('columns.user'),
      cell: (row) => (
        <Link
          href={`/users/${row.user_id}/briefings`}
          className="font-mono text-text-link hover:underline"
        >
          {row.user_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: 'generated_at',
      header: t('columns.generated'),
      sortable: true,
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
      id: 'mode',
      header: t('columns.mode'),
      cell: (row) => <EnumLabel group="narrativeMode" value={row.narrative_mode} />,
    },
  ];
  return (
    <DataTable<Row>
      tableId="briefings"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      emptyTitle={t('empty')}
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
        {
          key: 'user_id',
          label: t('filters.user'),
          kind: 'text',
          pattern: '^[0-9a-fA-F-]{36}$',
          options: [],
        },
        { key: 'local_date', label: t('filters.localDate'), kind: 'date', options: [] },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
