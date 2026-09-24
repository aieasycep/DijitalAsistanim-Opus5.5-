'use client';

import type { AdminReferralRow } from '@da/validation/admin/subscriptions';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { ReferralReview } from '@/components/referral-review';
import { StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AdminReferralRow>;

export function ReferralsTable({ data, flagged }: { data: TableData<Row>; flagged: boolean }) {
  const t = useTranslations('backoffice.referrals');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('referrals');
  const user = (id: string) => (
    <Link href={`/users/${id}/referrals`} className="font-mono text-text-link hover:underline">
      {id.slice(0, 8)}
    </Link>
  );
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.id.slice(0, 8)}</span>,
    },
    { id: 'referrer', header: t('columns.referrer'), cell: (row) => user(row.referrer_id) },
    { id: 'referee', header: t('columns.referee'), cell: (row) => user(row.referee_id) },
    {
      id: 'code',
      header: t('columns.code'),
      cell: (row) => <span className="font-mono">{row.code}</span>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="referralStatus" value={row.status} />,
    },
    {
      id: 'risk_score',
      header: t('columns.risk'),
      sortable: true,
      align: 'end',
      cell: (row) => f.percent(row.risk_score),
    },
    {
      id: 'signals',
      header: t('columns.signals'),
      cell: (row) => row.signals_summary.join(', ') || '—',
    },
    {
      id: 'created_at',
      header: t('columns.created'),
      sortable: true,
      cell: (row) => f.dateTime(row.created_at),
    },
  ];
  return (
    <DataTable<Row>
      tableId="referrals"
      caption={flagged ? t('tabs.flagged') : t('tabs.list')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      searchable
      searchPattern="^[A-HJ-NP-Z2-9]{6,8}$"
      emptyTitle={flagged ? t('emptyFlagged') : t('empty')}
      rowActions={(row) => <ReferralReview referralId={row.id} status={row.status} />}
      actionsLabel={t('columns.actions')}
      filters={
        flagged
          ? []
          : [
              {
                key: 'status',
                label: t('columns.status'),
                single: true,
                options: (['pending', 'qualified', 'rewarded', 'flagged', 'rejected'] as const).map(
                  (value) => ({
                    value,
                    label: label('referralStatus', value),
                  }),
                ),
              },
            ]
      }
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
