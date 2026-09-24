'use client';

import { AI_FEATURE_VALUES } from '@da/domain/enums';
import type { AiRequestRow } from '@da/validation/admin/ai';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AiRequestRow>;

/** AI request telemetry rows (§6.9): no prompt or response content exists in this contract. */
export function AiRequestsTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.ai');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('ai.requests');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'created_at',
      header: t('columns.time'),
      required: true,
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
    {
      id: 'feature',
      header: t('groups.feature'),
      cell: (row) => <EnumLabel group="aiFeature" value={row.feature} />,
    },
    {
      id: 'model',
      header: t('groups.model'),
      cell: (row) => (
        <span className="font-mono">
          {row.provider}/{row.model}
        </span>
      ),
    },
    {
      id: 'prompt',
      header: t('groups.prompt_version'),
      cell: (row) => <span className="font-mono">{row.prompt_version_id?.slice(0, 8) ?? '—'}</span>,
    },
    {
      id: 'tokens',
      header: t('columns.tokens'),
      align: 'end',
      cell: (row) => `${f.number(row.input_tokens)} / ${f.number(row.output_tokens)}`,
    },
    {
      id: 'cache',
      header: t('columns.cacheRead'),
      align: 'end',
      cell: (row) => f.number(row.cache_read_tokens),
    },
    {
      id: 'cost_usd',
      header: t('columns.cost'),
      align: 'end',
      sortable: true,
      cell: (row) => f.usd(row.cost_usd),
    },
    {
      id: 'latency_ms',
      header: t('columns.latency'),
      align: 'end',
      sortable: true,
      cell: (row) => f.duration(row.latency_ms),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="aiRequestStatus" value={row.status} />,
    },
    {
      id: 'correlation',
      header: t('columns.correlation'),
      cell: (row) =>
        row.correlation_id === null ? (
          '—'
        ) : (
          <Link
            href={`/jobs?q=${row.correlation_id}`}
            className="font-mono text-text-link hover:underline"
          >
            {row.correlation_id.slice(0, 8)}
          </Link>
        ),
    },
  ];
  return (
    <DataTable<Row>
      tableId="ai.requests"
      caption={t('requestsCaption')}
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
          key: 'feature',
          label: t('groups.feature'),
          single: true,
          options: AI_FEATURE_VALUES.map((value) => ({ value, label: label('aiFeature', value) })),
        },
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: (['ok', 'error', 'invalid_output', 'timeout', 'refused', 'cached'] as const).map(
            (value) => ({
              value,
              label: label('aiRequestStatus', value),
            }),
          ),
        },
        {
          key: 'model',
          label: t('groups.model'),
          kind: 'text',
          pattern: '^[A-Za-z0-9._:/-]{1,120}$',
          options: [],
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
