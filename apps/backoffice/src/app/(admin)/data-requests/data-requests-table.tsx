'use client';

import { DELETION_STATUS_VALUES, EXPORT_STATUS_VALUES } from '@da/domain/enums';
import type { DataRequestRow } from '@da/validation/admin/privacy-ops';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import { Badge } from '@/components/ui/card';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof DataRequestRow>;
const DAY_MS = 86_400_000;

/** Request age against the KVKK/GDPR 30-day window: warning after 7 days, critical after 25. */
export function ageTone(ageDays: number): 'neutral' | 'warning' | 'critical' {
  if (ageDays > 25) return 'critical';
  if (ageDays > 7) return 'warning';
  return 'neutral';
}

export function DataRequestsTable({
  data,
  tab,
  selectedId,
}: {
  data: TableData<Row>;
  tab: 'exports' | 'history_deletion' | 'account_deletion';
  selectedId?: string;
}) {
  const t = useTranslations('backoffice.dataRequests');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('data-requests');
  const [now] = useState(() => Date.now());
  const statuses = tab === 'exports' ? EXPORT_STATUS_VALUES : DELETION_STATUS_VALUES;
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.id.slice(0, 8)}</span>,
    },
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) => <span className="font-mono">{row.user_ref}</span>,
    },
    {
      id: 'origin',
      header: t('columns.origin'),
      cell: (row) => <EnumLabel group="origin" value={row.origin} />,
    },
    {
      id: 'requested_at',
      header: t('columns.requested'),
      sortable: true,
      cell: (row) => f.dateTime(row.requested_at),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) =>
        row.origin === 'web_otp' && row.status === 'requested' ? (
          <span className="text-bo-meta text-tone-warning-text">{t('awaitingEmail')}</span>
        ) : (
          <StatusBadge group="requestStatus" value={row.status} />
        ),
    },
    {
      id: 'steps',
      header: t('columns.steps'),
      cell: (row) => <span className="font-mono">{row.steps_summary ?? '—'}</span>,
    },
    {
      id: 'completed_at',
      header: t('columns.completed'),
      sortable: true,
      cell: (row) => f.dateTime(row.completed_at),
    },
    {
      id: 'age',
      header: t('columns.age'),
      cell: (row) => {
        const end = row.completed_at === null ? now : Date.parse(row.completed_at);
        const days = Math.max(0, Math.floor((end - Date.parse(row.requested_at)) / DAY_MS));
        return (
          <Badge tone={row.completed_at === null ? ageTone(days) : 'neutral'}>
            {t('ageDays', { days })}
          </Badge>
        );
      },
    },
  ];
  return (
    <DataTable<Row>
      tableId="data-requests"
      caption={t(`tabs.${tab}`)}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/data-requests?${tab === 'exports' ? '' : `tab=${tab}&`}request=${row.id}`}
      {...(selectedId === undefined ? {} : { selectedRowId: selectedId })}
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: statuses.map((value) => ({ value, label: label('requestStatus', value) })),
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
