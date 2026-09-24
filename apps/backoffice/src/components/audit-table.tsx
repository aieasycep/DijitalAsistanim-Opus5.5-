'use client';

import type { AuditRow } from '@da/validation/admin/privacy-ops';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AuditRow>;

const UUID_SOURCE = '^[0-9a-fA-F-]{36}$';
const ROLES = [
  'super_admin',
  'operations',
  'support',
  'finance',
  'ai_ops',
  'analyst',
  'readonly',
] as const;

/*
 * Audit log table (BACKOFFICE_PLAN §6.20, M§66): time, admin, role, action, target, reason, result
 * and correlation id, newest first (append-only, no edit or delete control anywhere). The filters
 * are the `AuditListQuery` allow-list.
 */
export function AuditTable({
  data,
  actions,
  tableId,
  userScoped = false,
  selectedId,
}: {
  data: TableData<Row>;
  actions: readonly string[];
  tableId: string;
  userScoped?: boolean;
  selectedId?: string;
}) {
  const t = useTranslations('backoffice.audit');
  const tr = useTranslations('backoffice.roles');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs(tableId);
  const columns: DataTableColumn<Row>[] = [
    { id: 'ts', header: t('columns.time'), required: true, cell: (row) => f.dateTime(row.ts) },
    { id: 'actor', header: t('columns.admin'), cell: (row) => row.actor },
    {
      id: 'role',
      header: t('columns.role'),
      cell: (row) =>
        row.role === null ? '—' : tr.has(row.role as never) ? tr(row.role as never) : row.role,
    },
    {
      id: 'action',
      header: t('columns.action'),
      cell: (row) => <span className="font-mono text-bo-mono">{row.action}</span>,
    },
    {
      id: 'target',
      header: t('columns.target'),
      cell: (row) => <span className="font-mono text-bo-mono">{row.target ?? '—'}</span>,
    },
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (row) => <span className="line-clamp-2 max-w-72">{row.reason ?? '—'}</span>,
    },
    {
      id: 'result',
      header: t('columns.result'),
      cell: (row) => <StatusBadge group="auditResult" value={row.result} />,
    },
    {
      id: 'correlation',
      header: t('columns.correlation'),
      cell: (row) => (
        <span className="font-mono text-bo-mono">{row.correlation_id?.slice(0, 8) ?? '—'}</span>
      ),
    },
  ];
  return (
    <DataTable<Row>
      tableId={tableId}
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      rowHref={(row) => `/audit?id=${row.id}`}
      {...(selectedId === undefined ? {} : { selectedRowId: selectedId })}
      emptyTitle={userScoped ? t('emptyUser') : t('empty')}
      filters={[
        {
          key: 'action',
          label: t('filters.action'),
          single: true,
          options: actions.map((value) => ({ value, label: value })),
        },
        {
          key: 'result',
          label: t('filters.result'),
          single: true,
          options: (['success', 'failure', 'denied'] as const).map((value) => ({
            value,
            label: label('auditResult', value),
          })),
        },
        {
          key: 'actor_role',
          label: t('filters.role'),
          single: true,
          options: ROLES.map((value) => ({ value, label: tr(value) })),
        },
        {
          key: 'actor_id',
          label: t('filters.admin'),
          kind: 'text',
          pattern: UUID_SOURCE,
          options: [],
        },
        ...(userScoped
          ? []
          : [
              {
                key: 'target_type',
                label: t('filters.targetType'),
                kind: 'text' as const,
                pattern: '^[a-z_]{2,40}$',
                options: [],
              },
              {
                key: 'target_id',
                label: t('filters.targetId'),
                kind: 'text' as const,
                pattern: '^[A-Za-z0-9._:-]{1,80}$',
                options: [],
              },
            ]),
        { key: 'from', label: t('filters.from'), kind: 'date', options: [] },
        { key: 'to', label: t('filters.to'), kind: 'date', options: [] },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
