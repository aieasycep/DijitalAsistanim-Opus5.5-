'use client';

import type { JobRow } from '@da/validation/admin/jobs';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { JobActions } from '@/components/job-actions';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';
import { JOB_STATUSES, JOB_TYPES_ORDERED } from './config';

type Row = z.infer<typeof JobRow>;
const UUID_SOURCE = '^[0-9a-fA-F-]{36}$';

export function JobsTable({ data, deadOnly }: { data: TableData<Row>; deadOnly: boolean }) {
  const t = useTranslations('backoffice.jobs');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('jobs');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.id.slice(0, 8)}</span>,
    },
    {
      id: 'type',
      header: t('columns.type'),
      cell: (row) => <EnumLabel group="jobType" value={row.type} />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="jobStatus" value={row.status} />,
    },
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) =>
        row.user_id === null ? (
          '—'
        ) : (
          <Link
            href={`/users/${row.user_id}/overview`}
            className="font-mono text-text-link hover:underline"
          >
            {row.user_id.slice(0, 8)}
          </Link>
        ),
    },
    {
      id: 'attempts',
      header: t('columns.attempts'),
      sortable: true,
      align: 'end',
      cell: (row) => `${f.number(row.attempts)}/${f.number(row.max_attempts)}`,
    },
    {
      id: 'run_after',
      header: t('columns.runAfter'),
      sortable: true,
      cell: (row) => f.dateTime(row.run_after),
    },
    {
      id: 'created_at',
      header: t('columns.created'),
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
    {
      id: 'error',
      header: t('columns.error'),
      cell: (row) => <span className="font-mono">{row.last_error_code ?? '—'}</span>,
    },
    {
      id: 'correlation',
      header: t('columns.correlation'),
      cell: (row) => <span className="font-mono">{row.correlation_id?.slice(0, 8) ?? '—'}</span>,
    },
  ];
  return (
    <DataTable<Row>
      tableId="jobs"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/jobs/${row.id}`}
      searchable
      searchPattern="^[0-9a-fA-F-]{8,64}$"
      emptyTitle={deadOnly ? t('emptyDead') : t('empty')}
      rowActions={(row) => <JobActions jobId={row.id} type={row.type} status={row.status} />}
      actionsLabel={t('columns.actions')}
      filters={[
        {
          key: 'status',
          label: t('filters.status'),
          single: true,
          options: JOB_STATUSES.map((value) => ({ value, label: label('jobStatus', value) })),
        },
        {
          key: 'type',
          label: t('filters.type'),
          single: true,
          options: JOB_TYPES_ORDERED.map((value) => ({ value, label: label('jobType', value) })),
        },
        {
          key: 'user_id',
          label: t('filters.user'),
          kind: 'text',
          pattern: UUID_SOURCE,
          options: [],
        },
        {
          key: 'account_id',
          label: t('filters.account'),
          kind: 'text',
          pattern: UUID_SOURCE,
          options: [],
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
