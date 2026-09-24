import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense, cache } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import type { ValueFormat } from '@/components/charts/chart-data';
import { MultiSeriesChartCard } from '@/components/charts/multi-series-chart';
import type { SeriesKind } from '@/components/charts/use-chart-colors';
import { Icon } from '@/components/icon';
import { KpiCard, Panel, ReadError, StatGrid } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { MetricGroups } from '@/components/metric-groups';
import { KpiSkeleton, LoadingState } from '@/components/states/loading-state';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card, CardTitle, Skeleton } from '@/components/ui/card';
import { serverEnv } from '@/env';
import { hasAnyPermission } from '@/lib/admin-context';
import { OTHER_KEY, aiRamp, breakdownEntries, pivotTop } from '@/lib/chart-transforms';
import { cn } from '@/lib/cn';
import { deltaDirection } from '@/lib/format';
import { effectiveStatus, overallHealth } from '@/lib/health';
import { requestTime } from '@/server/clock';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { RangePicker } from './range-picker';
import { RANGES, type Range } from './ranges';

/*
 * Dashboard (BACKOFFICE_PLAN §6.1, §7; M§50, M§119; T-10.05). Every number comes from admin-api
 * (`admin_api.dashboard_metrics` / `dashboard_series` / `metrics_ops` / `metrics_product`, which count
 * only the non-internal, non-demo population). Each card, chart and panel loads and fails on its own
 * with its own retry; panels the admin has no permission for are not rendered (cosmetic, the API
 * decides). Range 24h/7d/30d/90d is URL state and persisted as `dashboard_range`.
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

/** M§119 product and ops metrics carried by `GET /dashboard/metrics`, with their panel permission. */
const PRODUCT_KEYS = [
  { key: 'ai_cost_per_active_user', format: 'usd', permission: 'metrics.ai.read' },
  { key: 'classification_rate', format: 'percent', permission: 'metrics.ops.read' },
  { key: 'briefing_success_rate', format: 'percent', permission: 'metrics.ops.read' },
  { key: 'suppression_rate', format: 'percent', permission: 'metrics.ops.read' },
  { key: 'sync_success_rate', format: 'percent', permission: 'metrics.ops.read' },
  { key: 'reconnect_rate', format: 'percent', permission: 'metrics.ops.read' },
  { key: 'approval_conversion', format: 'percent', permission: 'metrics.product.read' },
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

/** One `GET /dashboard/metrics` per request and range, shared by the KPI and product panels. */
const dashboardMetrics = cache((range: Range) =>
  readAdmin('GET /dashboard/metrics', { query: { range } }),
);

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
  const can = (...permissions: string[]) => hasAnyPermission(context.permissions, permissions);
  const showProduct = PRODUCT_KEYS.some((item) => can(item.permission));

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<RangePicker value={range} />}
      />
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
      <section aria-label={t('panelsLabel')} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {showProduct ? (
          <Suspense
            key={`product-${range}`}
            fallback={<PanelSkeleton title={t('product.title')} />}
          >
            <ProductMetrics range={range} permissions={context.permissions} />
          </Suspense>
        ) : null}
        {can('metrics.ops.read') ? (
          <Suspense key={`ops-${range}`} fallback={<PanelSkeleton title={t('ops.title')} />}>
            <GroupsPanel range={range} kind="ops" />
          </Suspense>
        ) : null}
        {can('metrics.product.read') ? (
          <Suspense key={`funnel-${range}`} fallback={<PanelSkeleton title={t('funnel.title')} />}>
            <GroupsPanel range={range} kind="product" />
          </Suspense>
        ) : null}
        {can('health.read') ? (
          <Suspense fallback={<PanelSkeleton title={t('system.title')} />}>
            <SystemStatus />
          </Suspense>
        ) : null}
        {can('admins.manage') ? (
          <Suspense
            key={`security-${range}`}
            fallback={<PanelSkeleton title={t('security.title')} />}
          >
            <SecurityEvents range={range} />
          </Suspense>
        ) : null}
      </section>
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

function PanelSkeleton({ title }: { title: string }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      <LoadingState rows={4} />
    </Card>
  );
}

async function KpiGrid({ range }: { range: Range }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.dashboard'), getFormatters()]);
  const result = await dashboardMetrics(range);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} title={t('metricsFailed')} />
      </Card>
    );
  }
  return (
    <StatGrid label={t('kpisLabel')}>
      {KPI_KEYS.map((key) => {
        const metric = result.data[key];
        const direction = deltaDirection(metric.delta);
        const deltaText =
          direction === 'none'
            ? t('delta.none')
            : direction === 'flat'
              ? t('delta.flat')
              : t(`delta.${direction}`, {
                  value: f.number(Math.abs((metric.delta ?? 0) * 100), 1),
                });
        return (
          <KpiCard
            key={key}
            label={t(`kpis.${key}`)}
            value={key === 'ai_cost_usd' ? f.usd(metric.value) : f.number(metric.value)}
            testId={`kpi-${key}`}
            hint={
              <span
                className={cn(
                  'flex items-center gap-1',
                  direction === 'up' && 'text-tone-success-text',
                  direction === 'down' && 'text-tone-critical-text',
                )}
              >
                {direction === 'up' ? <Icon name="trending_up" size={16} /> : null}
                {direction === 'down' ? <Icon name="trending_down" size={16} /> : null}
                {deltaText}
              </span>
            }
          />
        );
      })}
    </StatGrid>
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
  const [t, tf] = await Promise.all([
    getTranslations('backoffice.dashboard'),
    getTranslations('backoffice.enums'),
  ]);
  const result = await readAdmin('GET /dashboard/charts', { query: { range, series } });
  if (!result.ok) {
    return (
      <Card className="flex flex-col gap-3">
        <CardTitle>{t(`charts.${series}`)}</CardTitle>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const points = result.data.points;
  if (series === 'ai_costs' && points.some((p) => p.breakdown !== undefined)) {
    const pivot = pivotTop(breakdownEntries(points, 'total'), 6);
    return (
      <MultiSeriesChartCard
        title={t(`charts.${series}`)}
        mode="stacked"
        format="usd"
        rows={pivot.rows}
        testId="chart-ai_costs"
        series={pivot.keys.map((key, index) => ({
          key,
          label:
            key === OTHER_KEY
              ? t('charts.other')
              : tf.has(`aiFeature.${key}` as never)
                ? tf(`aiFeature.${key}` as never)
                : key,
          kind: key === OTHER_KEY ? 'neutral' : 'ai',
          opacity: key === OTHER_KEY ? 1 : aiRamp(index),
        }))}
      />
    );
  }
  return (
    <ChartCard
      title={t(`charts.${series}`)}
      points={points.map((point) => ({ t: point.t, value: point.value }))}
      kind={kind}
      format={format}
    />
  );
}

async function ProductMetrics({
  range,
  permissions,
}: {
  range: Range;
  permissions: readonly string[];
}) {
  const [t, f] = await Promise.all([getTranslations('backoffice.dashboard'), getFormatters()]);
  const result = await dashboardMetrics(range);
  return (
    <Panel title={t('product.title')} description={t('product.description')}>
      {result.ok ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          {PRODUCT_KEYS.filter((item) => permissions.includes(item.permission)).map((item) => {
            const metric = result.data[item.key];
            return (
              <div key={item.key} className="flex flex-col gap-0.5">
                <dt className="text-bo-meta text-ink-3">{t(`product.${item.key}`)}</dt>
                <dd className="text-h3 text-ink tabular-nums" data-testid={`metric-${item.key}`}>
                  {item.format === 'usd' ? f.usd(metric.value) : f.percent(metric.value)}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <ReadError error={result.error} compact />
      )}
    </Panel>
  );
}

async function GroupsPanel({ range, kind }: { range: Range; kind: 'ops' | 'product' }) {
  const t = await getTranslations('backoffice.dashboard');
  const result = await readAdmin(kind === 'ops' ? 'GET /metrics/ops' : 'GET /metrics/product', {
    query: { range },
  });
  const title = kind === 'ops' ? t('ops.title') : t('funnel.title');
  return (
    <Panel title={title}>
      {result.ok ? (
        <MetricGroups groups={result.data.groups} />
      ) : (
        <ReadError error={result.error} compact />
      )}
    </Panel>
  );
}

async function SystemStatus() {
  const [t, th, f] = await Promise.all([
    getTranslations('backoffice.dashboard'),
    getTranslations('backoffice.health'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /health/summary');
  const now = requestTime();
  return (
    <Panel
      title={t('system.title')}
      actions={
        <Link href="/health" className="text-bo-body font-semibold text-text-link hover:underline">
          {t('system.open')}
        </Link>
      }
    >
      {result.ok ? (
        (() => {
          const overall = overallHealth(
            result.data.components,
            now,
            serverEnv().APP_ENV === 'production',
          );
          const issues = result.data.components.filter(
            (c) => effectiveStatus(c, now) !== 'healthy',
          );
          return (
            <div className="flex flex-col gap-3">
              <p className="text-bo-body font-semibold text-ink" data-testid="system-overall">
                {th(`overall.${overall}`)}
              </p>
              {issues.length === 0 ? (
                <p className="text-bo-meta text-ink-2">{t('system.noIssues')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {issues.map((component) => (
                    <li
                      key={component.component}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-bo-body text-ink">
                        <EnumLabel group="healthProbe" value={component.component} />
                      </span>
                      <span className="flex items-center gap-2 text-bo-meta text-ink-3">
                        {f.relative(component.checked_at, now)}
                        <StatusBadge group="healthStatus" value={effectiveStatus(component, now)} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()
      ) : (
        <ReadError error={result.error} compact />
      )}
    </Panel>
  );
}

async function SecurityEvents({ range }: { range: Range }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.dashboard'), getFormatters()]);
  const result = await readAdmin('GET /security-events', { query: { range } });
  return (
    <Panel
      title={t('security.title')}
      actions={
        <Link
          href="/audit?f.result=denied"
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('security.open')}
        </Link>
      }
    >
      {result.ok ? (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                'login_failures',
                'lockouts',
                'recovery_codes_used',
                'permission_denials',
                'webhook_signature_failures',
              ] as const
            ).map((key) => (
              <div key={key} className="flex flex-col gap-0.5">
                <dt className="text-bo-meta text-ink-3">{t(`security.${key}`)}</dt>
                <dd className="text-h3 text-ink tabular-nums">{f.number(result.data[key])}</dd>
              </div>
            ))}
          </dl>
          {result.data.by_admin.length === 0 ? null : (
            <ul aria-label={t('security.byAdmin')} className="flex flex-col gap-1">
              {result.data.by_admin.slice(0, 10).map((row) => (
                <li key={row.admin_id} className="flex justify-between text-bo-table">
                  <Link
                    href={`/audit?f.actor_id=${row.admin_id}`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {row.admin_id.slice(0, 8)}
                  </Link>
                  <span className="tabular-nums text-ink">{f.number(row.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <ReadError error={result.error} compact />
      )}
    </Panel>
  );
}
