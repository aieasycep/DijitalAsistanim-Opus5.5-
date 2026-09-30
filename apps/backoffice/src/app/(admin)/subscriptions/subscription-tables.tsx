'use client';

import { SUBSCRIPTION_STATUS_VALUES } from '@da/domain/enums';
import type {
  BillingEventRow,
  EntitlementGrantRow,
  SubscriptionRow,
} from '@da/validation/admin/subscriptions';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';

import { useCan } from '@/components/admin-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { RevokeGrantButton } from '@/components/entitlement-actions';
import { EnumLabel, StatusBadge, useEnumLabel } from '@/components/status-badge';
import type { TableData } from '@/lib/read-result';
import { useFormatters } from '@/lib/use-formatters';
import { ResyncButton } from '@/components/resync-button';

const UUID_SOURCE = '^[0-9a-fA-F-]{36}$';

type Subscriber = z.infer<typeof SubscriptionRow>;

export function SubscribersTable({ data }: { data: TableData<Subscriber> }) {
  const t = useTranslations('backoffice.subscriptions');
  const label = useEnumLabel();
  const f = useFormatters();
  const can = useCan();
  const table = useTablePrefs('subscriptions');
  const columns: DataTableColumn<Subscriber>[] = [
    {
      id: 'user',
      header: t('columns.user'),
      required: true,
      cell: (row) => <span className="font-mono">{row.user_id.slice(0, 8)}</span>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      sortable: true,
      cell: (row) => <StatusBadge group="subscriptionStatus" value={row.status} />,
    },
    {
      id: 'store',
      header: t('columns.store'),
      cell: (row) => <EnumLabel group="store" value={row.store} />,
    },
    {
      id: 'product',
      header: t('columns.product'),
      cell: (row) => <span className="font-mono">{row.product_id ?? '—'}</span>,
    },
    { id: 'period', header: t('columns.period'), cell: (row) => row.period_type ?? '—' },
    {
      id: 'expires_at',
      header: t('columns.expires'),
      sortable: true,
      cell: (row) => f.dateTime(row.expires_at),
    },
    {
      id: 'renew',
      header: t('columns.willRenew'),
      cell: (row) => (row.will_renew ? t('yes') : t('no')),
    },
  ];
  return (
    <DataTable<Subscriber>
      tableId="subscriptions"
      caption={t('tabs.subscribers')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.user_id}
      rowHref={(row) => `/users/${row.user_id}/subscription`}
      searchable
      searchPattern="^[A-Za-z0-9._:-]{3,80}$"
      emptyTitle={t('noSubscriptions')}
      {...(can('subscriptions.resync')
        ? {
            rowActions: (row: Subscriber) => <ResyncButton userId={row.user_id} />,
            actionsLabel: t('columns.actions'),
          }
        : {})}
      filters={[
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: SUBSCRIPTION_STATUS_VALUES.map((value) => ({
            value,
            label: label('subscriptionStatus', value),
          })),
        },
        {
          key: 'store',
          label: t('columns.store'),
          single: true,
          options: (['app_store', 'play_store', 'test_store', 'promotional'] as const).map(
            (value) => ({
              value,
              label: label('store', value),
            }),
          ),
        },
        {
          key: 'environment',
          label: t('columns.environment'),
          single: true,
          options: [
            { value: 'PRODUCTION', label: label('environment', 'production') },
            { value: 'SANDBOX', label: label('environment', 'sandbox') },
          ],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}

type BillingEvent = z.infer<typeof BillingEventRow>;

export function EventsTable({
  data,
  selectedId,
}: {
  data: TableData<BillingEvent>;
  selectedId?: string;
}) {
  const t = useTranslations('backoffice.subscriptions');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('subscriptions.events');
  const columns: DataTableColumn<BillingEvent>[] = [
    {
      id: 'event',
      header: t('event.id'),
      required: true,
      cell: (row) => <span className="font-mono">{row.event_id.slice(0, 12)}</span>,
    },
    {
      id: 'type',
      header: t('event.type'),
      cell: (row) => <span className="font-mono">{row.type}</span>,
    },
    {
      id: 'environment',
      header: t('columns.environment'),
      cell: (row) => <EnumLabel group="environment" value={row.environment} />,
    },
    {
      id: 'received_at',
      header: t('event.received'),
      sortable: true,
      cell: (row) => f.dateTime(row.received_at),
    },
    {
      id: 'processed',
      header: t('event.processedColumn'),
      cell: (row) => (row.processed ? t('yes') : t('pending')),
    },
  ];
  return (
    <DataTable<BillingEvent>
      tableId="subscriptions.events"
      caption={t('tabs.events')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.event_id}
      rowHref={(row) => `/subscriptions?tab=events&event=${encodeURIComponent(row.event_id)}`}
      {...(selectedId === undefined ? {} : { selectedRowId: selectedId })}
      emptyTitle={t('noEvents')}
      filters={[
        {
          key: 'type',
          label: t('event.type'),
          kind: 'text',
          pattern: '^[A-Z_]{3,64}$',
          options: [],
        },
        { key: 'user', label: t('columns.user'), kind: 'text', pattern: UUID_SOURCE, options: [] },
        {
          key: 'environment',
          label: t('columns.environment'),
          single: true,
          options: [
            { value: 'PRODUCTION', label: label('environment', 'production') },
            { value: 'SANDBOX', label: label('environment', 'sandbox') },
          ],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}

type Grant = z.infer<typeof EntitlementGrantRow>;

export function GrantsTable({ data }: { data: TableData<Grant> }) {
  const t = useTranslations('backoffice.subscriptions');
  const label = useEnumLabel();
  const f = useFormatters();
  const table = useTablePrefs('subscriptions.grants');
  const columns: DataTableColumn<Grant>[] = [
    {
      id: 'user',
      header: t('columns.user'),
      required: true,
      cell: (row) => (
        <Link
          href={`/users/${row.user_id}/subscription`}
          className="font-mono text-text-link hover:underline"
        >
          {row.email_masked ?? row.user_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: 'source',
      header: t('grants.source'),
      cell: (row) => <EnumLabel group="grantSource" value={row.source} />,
    },
    {
      id: 'days',
      header: t('grants.days'),
      align: 'end',
      cell: (row) => f.number(row.duration_days),
    },
    {
      id: 'starts_at',
      header: t('grants.starts'),
      sortable: true,
      cell: (row) => f.dateTime(row.starts_at),
    },
    { id: 'ends_at', header: t('grants.ends'), cell: (row) => f.dateTime(row.ends_at) },
    {
      id: 'state',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="grantState" value={row.state} />,
    },
    { id: 'granted_by', header: t('grants.grantedBy'), cell: (row) => row.granted_by ?? '—' },
    {
      id: 'reason',
      header: t('grants.reason'),
      cell: (row) => <span className="line-clamp-2 max-w-64">{row.reason ?? '—'}</span>,
    },
  ];
  return (
    <DataTable<Grant>
      tableId="subscriptions.grants"
      caption={t('tabs.grants')}
      columns={columns}
      rows={data.rows}
      total={data.total}
      totalIsEstimate={data.totalIsEstimate}
      status={data.status}
      {...(data.error === undefined ? {} : { error: data.error })}
      getRowId={(row) => row.id}
      emptyTitle={t('noGrants')}
      rowActions={(row) => <RevokeGrantButton userId={row.user_id} grant={row} />}
      actionsLabel={t('columns.actions')}
      filters={[
        {
          key: 'source',
          label: t('grants.source'),
          single: true,
          options: (
            ['admin', 'support', 'compensation', 'referral_referrer', 'referral_referee'] as const
          ).map((value) => ({ value, label: label('grantSource', value) })),
        },
        {
          key: 'state',
          label: t('columns.status'),
          single: true,
          options: (['active', 'scheduled', 'ended', 'revoked'] as const).map((value) => ({
            value,
            label: label('grantState', value),
          })),
        },
        {
          key: 'user_id',
          label: t('columns.user'),
          kind: 'text',
          pattern: UUID_SOURCE,
          options: [],
        },
        {
          key: 'granted_by_admin_id',
          label: t('grants.grantedBy'),
          kind: 'text',
          pattern: UUID_SOURCE,
          options: [],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}
