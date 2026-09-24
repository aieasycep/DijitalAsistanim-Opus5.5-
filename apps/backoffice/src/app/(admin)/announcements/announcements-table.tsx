'use client';

import type { AnnouncementRow } from '@da/validation/admin/product';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AnnouncementRow>;

export function AnnouncementsTable({
  data,
  selectedId,
}: {
  data: TableData<Row>;
  selectedId?: string;
}) {
  const t = useTranslations('backoffice.announcements');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('announcements');
  const columns: DataTableColumn<Row>[] = [
    { id: 'title', header: t('columns.title'), required: true, cell: (row) => row.title_tr },
    {
      id: 'audience',
      header: t('columns.audience'),
      cell: (row) => <EnumLabel group="audience" value={row.audience} />,
    },
    {
      id: 'platforms',
      header: t('columns.platforms'),
      cell: (row) => row.platforms.map((p) => label('platform', p)).join(', '),
    },
    {
      id: 'starts_at',
      header: t('columns.starts'),
      sortable: true,
      cell: (row) => f.dateTime(row.starts_at),
    },
    { id: 'ends_at', header: t('columns.ends'), cell: (row) => f.dateTime(row.ends_at) },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="announcementStatus" value={row.status} />,
    },
  ];
  return (
    <DataTable<Row>
      tableId="announcements"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/announcements?id=${row.id}`}
      {...(selectedId === undefined ? {} : { selectedRowId: selectedId })}
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: (['draft', 'scheduled', 'live', 'ended', 'cancelled'] as const).map((value) => ({
            value,
            label: label('announcementStatus', value),
          })),
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
