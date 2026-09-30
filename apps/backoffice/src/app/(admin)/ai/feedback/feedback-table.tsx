'use client';

import { AI_FEATURE_VALUES } from '@da/domain/enums';
import type { AiFeedbackRow } from '@da/validation/admin/ai';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { revealAction } from '@/actions/reveal';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { MaskedValue } from '@/components/masked-value';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AiFeedbackRow>;

export function AiFeedbackTable({ data }: { data: TableData<Row> }) {
  const t = useTranslations('backoffice.aiFeedback');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('ai.feedback');
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
      cell: (row) => <span className="font-mono">{row.model ?? '—'}</span>,
    },
    {
      id: 'prompt_version',
      header: t('groups.prompt_version'),
      cell: (row) => <span className="font-mono">{row.prompt_version ?? '—'}</span>,
    },
    {
      id: 'rating',
      header: t('columns.rating'),
      cell: (row) => (
        <StatusBadge group="rating" value={row.rating === 1 ? 'positive' : 'negative'} />
      ),
    },
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (row) => <span className="font-mono">{row.reason_code ?? '—'}</span>,
    },
    {
      id: 'comment',
      header: t('columns.comment'),
      // "Yorum var · gizli" only when a comment exists (§5.5); the text needs the audited reveal.
      cell: (row) =>
        row.has_comment ? (
          <MaskedValue
            masked={t('hidden')}
            label={t('columns.comment')}
            reveal={{
              permission: 'ai_feedback.reveal',
              reveal: (envelope) =>
                revealAction({ route: 'POST /ai/feedback/:id/reveal', id: row.id }, envelope),
            }}
          />
        ) : (
          <span className="text-ink-3" data-testid={`feedback-no-comment-${row.id}`}>
            {t('noComment')}
          </span>
        ),
    },
  ];
  return (
    <DataTable<Row>
      tableId="ai.feedback"
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
          key: 'feature',
          label: t('groups.feature'),
          single: true,
          options: AI_FEATURE_VALUES.map((value) => ({ value, label: label('aiFeature', value) })),
        },
        {
          key: 'rating',
          label: t('columns.rating'),
          single: true,
          options: [
            { value: '1', label: label('rating', 'positive') },
            { value: '-1', label: label('rating', 'negative') },
          ],
        },
        {
          key: 'prompt_version',
          label: t('groups.prompt_version'),
          kind: 'text',
          pattern: '^[A-Za-z0-9._-]{1,40}$',
          options: [],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
