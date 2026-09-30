'use client';

import type { FlagRow } from '@da/validation/admin/product';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { Badge } from '@/components/ui/card';
import { targetingSummary } from '@/lib/flags';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof FlagRow>;

export function FlagsTable({
  rows,
  total,
  selectedKey,
}: {
  rows: readonly Row[];
  total: number;
  selectedKey?: string;
}) {
  const t = useTranslations('backoffice.flags');
  const f = useFormatters();
  const table = useTablePrefs('flags');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'key',
      header: t('columns.key'),
      required: true,
      cell: (row) => <span className="font-mono">{row.key}</span>,
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (row) =>
        row.enabled ? (
          <Badge tone="success">{t('on')}</Badge>
        ) : (
          <Badge tone="neutral">{t('off')}</Badge>
        ),
    },
    {
      id: 'targeting',
      header: t('columns.targeting'),
      cell: (row) => <span className="font-mono text-bo-mono">{targetingSummary(row)}</span>,
    },
    { id: 'updated', header: t('columns.updated'), cell: (row) => f.dateTime(row.updated_at) },
    { id: 'updated_by', header: t('columns.updatedBy'), cell: (row) => row.updated_by ?? '—' },
  ];
  return (
    <DataTable<Row>
      tableId="flags"
      caption={t('caption')}
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(row) => row.key}
      rowHref={(row) => `/flags?flag=${encodeURIComponent(row.key)}`}
      {...(selectedKey === undefined ? {} : { selectedRowId: selectedKey })}
      emptyTitle={t('empty')}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
