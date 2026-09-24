import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import type { SeriesKind } from '@/components/charts/use-chart-colors';
import type { ValueFormat } from '@/components/charts/chart-data';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states/error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { KpiSkeleton } from '@/components/states/loading-state';
import { Card, CardTitle, Skeleton } from '@/components/ui/card';
import { Icon } from '@/components/icon';
import { deltaDirection, formatNumber, formatUsd } from '@/lib/format';
import { cn } from '@/lib/cn';
import { adminApi } from '@/server/admin-api';
import { loadAdminContext } from '@/server/session';
import { RangePicker } from './range-picker';
import { RANGES, type Range } from './ranges';

/*
 * Dashboard (BACKOFFICE_PLAN §6.1, M§50): the post-login landing page. Every number comes from
 * admin-api (`GET /dashboard/metrics`, `GET /dashboard/charts`); each card and chart loads and fails
 * independently, with its own retry. The ops/product panels, security events and platform filter
 * are added by T-10.05 together with the metric rollups.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.dashboard');
  return { title: t('title') };
}

const KPI_KEYS = [
  'total_users',
  'active_users',
  'new_users',
  'pro_users',
  'trials',
  'connected_emails',
  'connected_calendars',
  'ai_requests',
  'ai_cost_usd',
  'briefings_generated',
  'push_sent',
] as const;

const SERIES: readonly {
  key: 'user_growth' | 'active_usage' | 'ai_costs' | 'subscriptions' | 'sync_failures';
  kind: SeriesKind;
  format: ValueFormat;
}[] = [
  { key: 'user_growth', kind: 'info', format: 'number' },
  { key: 'active_usage', kind: 'info', format: 'number' },
  { key: 'ai_costs', kind: 'ai', format: 'usd' },
  { key: 'subscriptions', kind: 'success', format: 'number' },
  { key: 'sync_failures', kind: 'failure', format: 'number' },
];

function isRange(value: unknown): value is Range {
  return typeof value === 'string' && (RANGES as readonly string[]).includes(value);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [context, t, params] = await Promise.all([
    loadAdminContext(),
    getTranslations('backoffice.dashboard'),
    searchParams,
  ]);
  const range: Range = isRange(params.range) ? params.range : context.preferences.dashboard_range;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          context.permissions.includes('dashboard.read') ? <RangePicker value={range} /> : undefined
        }
      />
      {context.permissions.includes('dashboard.read') ? (
        <>
          <section aria-label={t('kpisLabel')}>
            <Suspense key={`kpi-${range}`} fallback={<KpiGridSkeleton />}>
              <KpiGrid range={range} />
            </Suspense>
          </section>
          <section aria-label={t('chartsLabel')} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {SERIES.map((series) => (
              <Suspense
                key={`${series.key}-${range}`}
                fallback={<ChartSkeleton title={t(`charts.${series.key}`)} />}
              >
                <DashboardChart
                  range={range}
                  series={series.key}
                  kind={series.kind}
                  format={series.format}
                />
              </Suspense>
            ))}
          </section>
        </>
      ) : (
        <ForbiddenState />
      )}
    </>
  );
}

function KpiGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {KPI_KEYS.map((key) => (
        <KpiSkeleton key={key} />
      ))}
    </div>
  );
}

async function KpiGrid({ range }: { range: Range }) {
  const [t, locale] = await Promise.all([getTranslations('backoffice.dashboard'), getLocale()]);
  const result = await adminApi('GET /dashboard/metrics', { query: { range } });
  if (!result.ok) {
    return (
      <Card>
        <ErrorState
          title={t('metricsFailed')}
          code={result.error.code}
          correlationId={result.error.correlationId}
          refreshOnRetry
        />
      </Card>
    );
  }
  const ui = locale;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {KPI_KEYS.map((key) => {
        const metric = result.data[key];
        const direction = deltaDirection(metric.delta);
        const deltaText =
          direction === 'none'
            ? t('delta.none')
            : direction === 'flat'
              ? t('delta.flat')
              : t(`delta.${direction}`, {
                  value: formatNumber(ui, Math.abs((metric.delta ?? 0) * 100), 1),
                });
        return (
          <li key={key} className="rounded-card-sm bg-surface p-5 shadow-card">
            <p className="text-bo-kicker text-ink-3 uppercase">{t(`kpis.${key}`)}</p>
            <p className="mt-2 text-h1 text-ink tabular-nums" data-testid={`kpi-${key}`}>
              {key === 'ai_cost_usd' ? formatUsd(ui, metric.value) : formatNumber(ui, metric.value)}
            </p>
            <p
              className={cn(
                'mt-2 flex items-center gap-1 text-bo-meta',
                direction === 'up' && 'text-tone-success-text',
                direction === 'down' && 'text-tone-critical-text',
                (direction === 'flat' || direction === 'none') && 'text-ink-3',
              )}
            >
              {direction === 'up' ? <Icon name="trending_up" size={16} /> : null}
              {direction === 'down' ? <Icon name="trending_down" size={16} /> : null}
              {deltaText}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      <Skeleton className="h-[220px] w-full" />
    </Card>
  );
}

async function DashboardChart({
  range,
  series,
  kind,
  format,
}: {
  range: Range;
  series: (typeof SERIES)[number]['key'];
  kind: SeriesKind;
  format: ValueFormat;
}) {
  const t = await getTranslations('backoffice.dashboard');
  const result = await adminApi('GET /dashboard/charts', { query: { range, series } });
  if (!result.ok) {
    return (
      <Card className="flex flex-col gap-3">
        <CardTitle>{t(`charts.${series}`)}</CardTitle>
        <ErrorState
          compact
          code={result.error.code}
          correlationId={result.error.correlationId}
          refreshOnRetry
        />
      </Card>
    );
  }
  return (
    <ChartCard
      title={t(`charts.${series}`)}
      points={result.data.points.map((point) => ({ t: point.t, value: point.value }))}
      kind={kind}
      format={format}
    />
  );
}
