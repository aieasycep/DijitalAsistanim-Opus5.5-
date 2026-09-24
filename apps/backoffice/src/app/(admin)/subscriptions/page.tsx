import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import {
  BarList,
  KeyValueList,
  KpiCard,
  Panel,
  ReadError,
  StatGrid,
  TabNav,
  withParam,
} from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { RangeLinks } from '@/components/range-links';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { METRIC_RANGES, parseRange, type MetricRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { EventsTable, GrantsTable, SubscribersTable } from './subscription-tables';

/*
 * Abonelikler (BACKOFFICE_PLAN §6.13, §7.5; M§60, M§43; ADR-11; T-10.11): store subscriptions and
 * admin/referral grants are counted and listed separately. Overview KPIs and the store/product
 * split; MRR/ARR only when admin-api includes them (`metrics.revenue.read`); subscribers with
 * resync; sanitised RevenueCat events (never the raw payload); entitlement grants with revoke; the
 * trial → paid stream.
 */

const TABS = ['overview', 'subscribers', 'events', 'grants', 'trials'] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.subscriptions');
  return { title: t('title') };
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([
    getTranslations('backoffice.subscriptions'),
    searchParams,
  ]);
  const tab: Tab = parseRange(params.tab, TABS, 'overview');
  const range = parseRange(params.range, METRIC_RANGES, '30d');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          tab === 'overview' || tab === 'trials' ? (
            <RangeLinks path="/subscriptions" params={params} active={range} />
          ) : undefined
        }
      />
      <TabNav
        label={t('tabs.label')}
        active={tab}
        items={TABS.map((key) => ({
          key,
          href: key === 'overview' ? '/subscriptions' : `/subscriptions?tab=${key}`,
          label: t(`tabs.${key}`),
        }))}
      />
      <Suspense key={`${tab}-${range}`} fallback={<LoadingState rows={6} />}>
        {tab === 'overview' ? <Overview range={range} /> : null}
        {tab === 'subscribers' ? <Subscribers params={params} /> : null}
        {tab === 'events' ? <Events params={params} /> : null}
        {tab === 'grants' ? <Grants params={params} /> : null}
        {tab === 'trials' ? <Trials range={range} params={params} /> : null}
      </Suspense>
    </>
  );
}

async function Overview({ range }: { range: MetricRange }) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.subscriptions'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /subscriptions/metrics', { query: { range } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} />
      </Card>
    );
  }
  const m = result.data;
  const storeLabel = (key: string) =>
    te.has(`store.${key}` as never) ? te(`store.${key}` as never) : key;
  return (
    <div className="flex flex-col gap-4">
      <StatGrid label={t('kpis')}>
        <KpiCard
          label={t('kpi.activePro')}
          value={f.number(m.active_pro)}
          testId="subs-active-pro"
        />
        <KpiCard label={t('kpi.storePro')} value={f.number(m.store_pro)} testId="subs-store-pro" />
        <KpiCard label={t('kpi.grantPro')} value={f.number(m.grant_pro)} testId="subs-grant-pro" />
        <KpiCard label={t('kpi.both')} value={f.number(m.both)} />
        <KpiCard label={t('kpi.trials')} value={f.number(m.trials)} />
        <KpiCard label={t('kpi.cancelled')} value={f.number(m.cancelled)} />
        <KpiCard label={t('kpi.expired')} value={f.number(m.expired)} />
        <KpiCard label={t('kpi.refunded')} value={f.number(m.refunded)} />
        <KpiCard label={t('kpi.renewalRate')} value={f.percent(m.renewal_rate)} />
        {m.mrr_usd === undefined ? null : (
          <KpiCard
            label={t('kpi.mrr')}
            value={f.usd(m.mrr_usd)}
            hint={t('kpi.mrrHint')}
            testId="subs-mrr"
          />
        )}
        {m.arr_estimate_usd === undefined ? null : (
          <KpiCard label={t('kpi.arr')} value={f.usd(m.arr_estimate_usd)} testId="subs-arr" />
        )}
      </StatGrid>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('byStore')}>
          <BarList
            label={t('byStore')}
            emptyText={t('noSubscriptions')}
            items={Object.entries(m.by_store).map(([key, value]) => ({
              key,
              label: storeLabel(key),
              value,
              display: f.number(value),
            }))}
          />
        </Panel>
        <Panel title={t('byProduct')}>
          <BarList
            label={t('byProduct')}
            emptyText={t('noSubscriptions')}
            items={Object.entries(m.by_product).map(([key, value]) => ({
              key,
              label: key,
              value,
              display: f.number(value),
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

const SUB_FILTERS = ['status', 'store', 'environment'] as const;

async function Subscribers({ params }: { params: Record<string, string | string[] | undefined> }) {
  const state = loadTableState(params, SUB_FILTERS);
  const result = await readAdmin('GET /subscriptions', {
    query: toAdminListQuery(state, {
      sortable: ['expires_at', 'status'],
      filterKeys: SUB_FILTERS,
      transform: { status: firstValue, store: firstValue, environment: firstValue },
    }),
  });
  return <SubscribersTable data={toTableData(result)} />;
}

const EVENT_FILTERS = ['type', 'user', 'environment'] as const;

async function Events({ params }: { params: Record<string, string | string[] | undefined> }) {
  const state = loadTableState(params, EVENT_FILTERS);
  const eventId =
    typeof params.event === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(params.event)
      ? params.event
      : null;
  const result = await readAdmin('GET /subscriptions/events', {
    query: toAdminListQuery(state, {
      sortable: ['received_at'],
      filterKeys: EVENT_FILTERS,
      search: false,
      transform: { type: firstValue, user: firstValue, environment: firstValue },
    }),
  });
  return (
    <div className="flex flex-col gap-4">
      {eventId === null ? null : (
        <EventDetail
          id={eventId}
          closeHref={withParam('/subscriptions', params, { event: null })}
        />
      )}
      <EventsTable
        data={toTableData(result)}
        {...(eventId === null ? {} : { selectedId: eventId })}
      />
    </div>
  );
}

async function EventDetail({ id, closeHref }: { id: string; closeHref: string }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.subscriptions'), getFormatters()]);
  const result = await readAdmin('GET /subscriptions/events/:id', { params: { id } });
  return (
    <Panel
      title={t('event.title')}
      description={t('event.sanitised')}
      testId="billing-event"
      actions={
        <Link
          href={closeHref}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('event.close')}
        </Link>
      }
    >
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : (
        <KeyValueList
          columns={3}
          items={[
            { label: t('event.id'), value: result.data.event_id, mono: true },
            { label: t('event.type'), value: result.data.type, mono: true },
            { label: t('event.store'), value: result.data.store ?? '—' },
            {
              label: t('event.environment'),
              value: <EnumLabel group="environment" value={result.data.environment} />,
            },
            { label: t('event.product'), value: result.data.product_id ?? '—', mono: true },
            { label: t('event.periodType'), value: result.data.period_type ?? '—' },
            { label: t('event.purchased'), value: f.dateTime(result.data.purchased_at) },
            { label: t('event.expiration'), value: f.dateTime(result.data.expiration_at) },
            { label: t('event.eventAt'), value: f.dateTime(result.data.event_at) },
            { label: t('event.priceUsd'), value: f.usd(result.data.price_usd) },
            {
              label: t('event.priceLocal'),
              value:
                result.data.price_local === null || result.data.currency === null
                  ? '—'
                  : `${f.number(result.data.price_local, 2)} ${result.data.currency}`,
            },
            { label: t('event.cancelReason'), value: result.data.cancel_reason ?? '—', mono: true },
            {
              label: t('event.expirationReason'),
              value: result.data.expiration_reason ?? '—',
              mono: true,
            },
            {
              label: t('event.trialConversion'),
              value:
                result.data.is_trial_conversion === null
                  ? '—'
                  : result.data.is_trial_conversion
                    ? t('yes')
                    : t('no'),
            },
            { label: t('event.received'), value: f.dateTime(result.data.received_at) },
            { label: t('event.processed'), value: f.dateTime(result.data.processed_at) },
            {
              label: t('event.error'),
              value: result.data.processing_error_code ?? '—',
              mono: true,
            },
            {
              label: t('event.job'),
              value:
                result.data.job_id === null ? (
                  '—'
                ) : (
                  <Link
                    href={`/jobs/${result.data.job_id}`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {result.data.job_id.slice(0, 8)}
                  </Link>
                ),
            },
            {
              label: t('event.user'),
              value:
                result.data.user_id === null ? (
                  '—'
                ) : (
                  <Link
                    href={`/users/${result.data.user_id}/subscription`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {result.data.user_id.slice(0, 8)}
                  </Link>
                ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

const GRANT_FILTERS = ['source', 'state', 'user_id', 'granted_by_admin_id'] as const;

async function Grants({ params }: { params: Record<string, string | string[] | undefined> }) {
  const state = loadTableState(params, GRANT_FILTERS);
  const result = await readAdmin('GET /entitlement-grants', {
    query: toAdminListQuery(state, {
      sortable: ['starts_at'],
      filterKeys: GRANT_FILTERS,
      search: false,
      transform: {
        source: firstValue,
        state: firstValue,
        user_id: firstValue,
        granted_by_admin_id: firstValue,
      },
    }),
  });
  return <GrantsTable data={toTableData(result)} />;
}

async function Trials({
  range,
  params,
}: {
  range: MetricRange;
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.subscriptions'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const environment = params.environment === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
  const result = await readAdmin('GET /subscriptions/trial-stream', {
    query: { range, 'filter[environment]': environment },
  });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} />
      </Card>
    );
  }
  const { summary, events } = result.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-bo-body">
        {(['PRODUCTION', 'SANDBOX'] as const).map((env) => (
          <Link
            key={env}
            href={withParam('/subscriptions', params, { environment: env })}
            aria-current={env === environment ? 'page' : undefined}
            className={
              env === environment ? 'font-semibold text-ink' : 'text-text-link hover:underline'
            }
          >
            {te(`environment.${env === 'SANDBOX' ? 'sandbox' : 'production'}`)}
          </Link>
        ))}
      </div>
      <StatGrid label={t('trials.summary')} columns={3}>
        <KpiCard label={t('trials.conversions')} value={f.number(summary.conversions)} />
        <KpiCard label={t('trials.expirations')} value={f.number(summary.trial_expirations)} />
        <KpiCard
          label={t('trials.rate')}
          value={f.percent(summary.conversion_rate)}
          testId="trial-conversion"
        />
      </StatGrid>
      <Panel title={t('trials.stream')}>
        {events.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('trials.empty')}</p>
        ) : (
          <table className="w-full text-bo-table tabular-nums">
            <caption className="sr-only">{t('trials.stream')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('trials.time')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('trials.kind')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('trials.user')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('trials.product')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('trials.store')}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.event_id} className="border-t border-border-row">
                  <td className="py-1.5 pr-3 text-ink">{f.dateTime(event.event_at)}</td>
                  <td className="py-1.5 pr-3 text-ink">
                    <EnumLabel group="trialKind" value={event.kind} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{event.email_masked ?? '—'}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">{event.product_id ?? '—'}</td>
                  <td className="py-1.5 text-ink">{event.store ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
