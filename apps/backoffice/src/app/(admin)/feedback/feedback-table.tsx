'use client';

import type { FeedbackRow } from '@da/validation/admin/product';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { revealAction } from '@/actions/reveal';
import { useInlineMutation } from '@/components/action-dialog';
import { useAdmin, useCan } from '@/components/admin-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { MaskedValue } from '@/components/masked-value';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { fieldClassName } from '@/components/ui/input';
import { autoMask } from '@/lib/automask';
import { cn } from '@/lib/cn';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof FeedbackRow>;
const STATUSES = ['new', 'triaged', 'planned', 'closed'] as const;

export function FeedbackTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.feedback');
  const label = useEnumLabel();
  const f = useFormatters();
  const can = useCan();
  const admin = useAdmin();
  const { run, pending } = useInlineMutation();
  const table = useTablePrefs('feedback');
  const writable = can('feedback.write');
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'created_at',
      header: t('columns.time'),
      required: true,
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
    {
      id: 'type',
      header: t('columns.type'),
      cell: (row) => <EnumLabel group="feedbackType" value={row.type} />,
    },
    {
      id: 'rating',
      header: t('columns.rating'),
      align: 'end',
      cell: (row) => (row.rating === null ? '—' : f.number(row.rating)),
    },
    {
      id: 'message',
      header: t('columns.message'),
      cell: (row) =>
        row.message === null ? (
          '—'
        ) : (
          <MaskedValue
            masked={autoMask(row.message)}
            label={t('columns.message')}
            className="line-clamp-2 max-w-96"
            reveal={{
              permission: 'users.pii.reveal',
              reveal: (envelope) =>
                revealAction({ route: 'POST /feedback/:id/reveal', id: row.id }, envelope),
            }}
          />
        ),
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
      id: 'status',
      header: t('columns.status'),
      sortable: true,
      cell: (row) =>
        writable ? (
          <select
            aria-label={t('statusFor', { id: row.id.slice(0, 8) })}
            value={row.status}
            disabled={pending}
            className={cn(fieldClassName, 'h-8 w-40')}
            onChange={(event) => {
              run('PATCH /feedback/:id', { id: row.id }, { status: event.target.value });
            }}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {label('feedbackStatus', value)}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge group="feedbackStatus" value={row.status} />
        ),
    },
    {
      id: 'assignee',
      header: t('columns.assignee'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          <span>{row.assignee ?? t('unassigned')}</span>
          {writable && admin !== null ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                run(
                  'PATCH /feedback/:id',
                  { id: row.id },
                  { assignee_admin_id: row.assignee === null ? admin.admin.id : null },
                );
              }}
            >
              {row.assignee === null ? t('assignToMe') : t('unassign')}
            </Button>
          ) : null}
        </span>
      ),
    },
    { id: 'user', header: t('columns.user'), cell: (row) => row.user_email_masked ?? '—' },
  ];
  return (
    <DataTable<Row>
      tableId="feedback"
      caption={t('caption')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      searchable
      searchPattern="^[0-9a-fA-F-]{8,36}$"
      emptyTitle={t('empty')}
      filters={[
        {
          key: 'type',
          label: t('columns.type'),
          single: true,
          options: (['bug', 'feature', 'general', 'ai_quality'] as const).map((value) => ({
            value,
            label: label('feedbackType', value),
          })),
        },
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: STATUSES.map((value) => ({ value, label: label('feedbackStatus', value) })),
        },
        {
          key: 'platform',
          label: t('columns.platform'),
          single: true,
          options: (['ios', 'android'] as const).map((value) => ({
            value,
            label: label('platform', value),
          })),
        },
        {
          key: 'app_version',
          label: t('filters.version'),
          kind: 'text',
          pattern: '^\\d+\\.\\d+\\.\\d+$',
          options: [],
        },
        ...(admin === null
          ? []
          : [
              {
                key: 'assignee',
                label: t('columns.assignee'),
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
