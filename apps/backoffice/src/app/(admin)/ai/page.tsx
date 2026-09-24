import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense, cache } from 'react';

import { MultiSeriesChartCard } from '@/components/charts/multi-series-chart';
import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import {
  KpiCard,
  Panel,
  ReadError,
  SegmentedLinks,
  StatGrid,
  withParam,
} from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { RangeLinks } from '@/components/range-links';
import { LoadingState } from '@/components/states/loading-state';
import { Card } from '@/components/ui/card';
import { OTHER_KEY, aiRamp, pivotTop, weightedRate } from '@/lib/chart-transforms';
import { METRIC_RANGES, parseRange, type MetricRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { AiTabs } from './ai-tabs';
import { AiRequestsTable } from './requests-table';

/*
 * AI Operasyonları (BACKOFFICE_PLAN §6.9, §7.5; M§56, M§82, M§119; T-10.10): requests, tokens,
 * cost, error rate and p50/p95 latency by M§56 feature, model, day, prompt version and routing
 * profile; the daily cost stacked by feature (top 6 + "Diğer"), cost by feature and by model, the
 * latency and error-rate lines, and (with `ai.read`) the telemetry request rows. Telemetry has no
 * prompt or response content by construction. Kill switches live in Feature Flags (`ai.*`).
 */

const GROUPS = ['feature', 'model', 'prompt_version', 'profile'] as const;
type Group = (typeof GROUPS)[number];
const REQUEST_FILTERS = ['feature', 'model', 'status', 'user_id'] as const;

const metrics = cache((range: MetricRange, groupBy: Group | 'day') =>
  readAdmin('GET /ai/metrics', { query: { range, group_by: groupBy } }),
);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.ai');
  return { title: t('title') };
}

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.ai'), searchParams]);
  const range = parseRange(params.range, METRIC_RANGES, '7d');
  const tab = params.tab === 'requests' ? 'requests' : 'overview';
  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <>
          {tab === 'overview' ? <RangeLinks path="/ai" params={params} active={range} /> : null}
          <Link href="/flags" className="text-bo-body font-semibold text-text-link hover:underline">
            {t('killSwitches')}
          </Link>
        </>
      }
    />
  );
  if (tab === 'requests') {
    const state = loadTableState(params, REQUEST_FILTERS);
    const result = await readAdmin('GET /ai/requests', {
      query: toAdminListQuery(state, {
        sortable: ['created_at', 'cost_usd', 'latency_ms'],
        filterKeys: REQUEST_FILTERS,
        search: false,
        transform: {
          feature: firstValue,
          model: firstValue,
          status: firstValue,
          user_id: firstValue,
        },
      }),
    });
    return (
      <>
        {header}
        <AiTabs active="requests" />
        <AiRequestsTable data={toTableData(result, { aggregatesVisible: true })} />
      </>
    );
  }
  const group = parseRange(params.group, GROUPS, 'feature');
  return (
    <>
      {header}
      <AiTabs active="overview" />
      <Suspense key={`kpi-${range}`} fallback={<LoadingState rows={2} />}>
        <Totals range={range} />
      </Suspense>
      <section aria-label={t('chartsLabel')} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Suspense key={`series-${range}`} fallback={<LoadingState rows={6} />}>
          <DailyCost range={range} />
        </Suspense>
        <Suspense key={`bars-${range}`} fallback={<LoadingState rows={6} />}>
          <CostBars range={range} />
        </Suspense>
        <Suspense key={`lines-${range}`} fallback={<LoadingState rows={6} />}>
          <DayLines range={range} />
        </Suspense>
      </section>
      <Suspense key={`breakdown-${range}-${group}`} fallback={<LoadingState rows={6} />}>
        <Breakdown range={range} group={group} params={params} />
      </Suspense>
    </>
  );
}

async function Totals({ range }: { range: MetricRange }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.ai'), getFormatters()]);
  const result = await metrics(range, 'feature');
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} aggregatesOnly />
      </Card>
    );
  }
  const rows = result.data;
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((s, row) => s + pick(row), 0);
  const requests = sum((r) => r.requests);
  const cost = sum((r) => r.cost_usd);
  const errorRate = weightedRate(rows.map((r) => ({ requests: r.requests, rate: r.error_rate })));
  return (
    <StatGrid label={t('totals')} columns={3}>
      <KpiCard label={t('kpi.requests')} value={f.number(requests)} testId="ai-requests" />
      <KpiCard label={t('kpi.cost')} value={f.usd(cost)} testId="ai-cost" />
      <KpiCard
        label={t('kpi.costPerRequest')}
        value={requests === 0 ? '—' : f.usd(cost / requests)}
      />
      <KpiCard label={t('kpi.inputTokens')} value={f.number(sum((r) => r.input_tokens))} />
      <KpiCard label={t('kpi.outputTokens')} value={f.number(sum((r) => r.output_tokens))} />
      <KpiCard label={t('kpi.cacheRead')} value={f.number(sum((r) => r.cache_read_tokens))} />
      <KpiCard
        label={t('kpi.errorRate')}
        value={f.percent(errorRate)}
        tone={errorRate !== null && errorRate > 0.05 ? 'warning' : undefined}
        testId="ai-error-rate"
      />
    </StatGrid>
  );
}

async function DailyCost({ range }: { range: MetricRange }) {
  const [t, te] = await Promise.all([
    getTranslations('backoffice.ai'),
    getTranslations('backoffice.enums'),
  ]);
  const result = await readAdmin('GET /ai/metrics/series', { query: { range, split: 'feature' } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const pivot = pivotTop(
    result.data.points.map((p) => ({ t: p.t, key: p.key, value: p.cost_usd })),
    6,
  );
  return (
    <MultiSeriesChartCard
      title={t('charts.dailyCost')}
      mode="stacked"
      format="usd"
      rows={pivot.rows}
      testId="chart-daily-cost"
      series={pivot.keys.map((key, index) => ({
        key,
        label:
          key === OTHER_KEY
            ? t('charts.other')
            : te.has(`aiFeature.${key}` as never)
              ? te(`aiFeature.${key}` as never)
              : key,
        kind: key === OTHER_KEY ? 'neutral' : 'ai',
        opacity: key === OTHER_KEY ? 1 : aiRamp(index),
      }))}
    />
  );
}

async function CostBars({ range }: { range: MetricRange }) {
  const [t, te] = await Promise.all([
    getTranslations('backoffice.ai'),
    getTranslations('backoffice.enums'),
  ]);
  const [byFeature, byModel] = await Promise.all([
    metrics(range, 'feature'),
    metrics(range, 'model'),
  ]);
  return (
    <>
      {byFeature.ok ? (
        <MultiSeriesChartCard
          title={t('charts.byFeature')}
          mode="bars"
          format="usd"
          categorical
          testId="chart-cost-feature"
          rows={byFeature.data.map((row) => ({
            t: te.has(`aiFeature.${row.key}` as never)
              ? te(`aiFeature.${row.key}` as never)
              : row.key,
            cost: row.cost_usd,
          }))}
          series={[{ key: 'cost', label: t('kpi.cost'), kind: 'ai' }]}
        />
      ) : (
        <Card>
          <ReadError error={byFeature.error} compact />
        </Card>
      )}
      {byModel.ok ? (
        <MultiSeriesChartCard
          title={t('charts.byModel')}
          mode="bars"
          format="usd"
          categorical
          testId="chart-cost-model"
          rows={byModel.data.map((row) => ({ t: row.key, cost: row.cost_usd }))}
          series={[{ key: 'cost', label: t('kpi.cost'), kind: 'ai' }]}
        />
      ) : (
        <Card>
          <ReadError error={byModel.error} compact />
        </Card>
      )}
    </>
  );
}

async function DayLines({ range }: { range: MetricRange }) {
  const t = await getTranslations('backoffice.ai');
  const result = await metrics(range, 'day');
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const days = [...result.data].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <>
      <MultiSeriesChartCard
        title={t('charts.latency')}
        mode="lines"
        testId="chart-latency"
        rows={days.map((row) => ({ t: row.key, p50: row.p50_ms ?? 0, p95: row.p95_ms ?? 0 }))}
        series={[
          { key: 'p50', label: t('charts.p50'), kind: 'ai' },
          { key: 'p95', label: t('charts.p95'), kind: 'ai', dashed: true },
        ]}
      />
      <MultiSeriesChartCard
        title={t('charts.errorRate')}
        mode="lines"
        format="percent"
        rows={days.map((row) => ({ t: row.key, rate: row.error_rate }))}
        series={[{ key: 'rate', label: t('kpi.errorRate'), kind: 'failure' }]}
      />
    </>
  );
}

async function Breakdown({
  range,
  group,
  params,
}: {
  range: MetricRange;
  group: Group;
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.ai'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await metrics(range, group);
  const keyLabel = (key: string) => {
    if (group === 'feature' && te.has(`aiFeature.${key}` as never))
      return te(`aiFeature.${key}` as never);
    if (group === 'profile' && te.has(`routingProfile.${key}` as never))
      return te(`routingProfile.${key}` as never);
    return key;
  };
  return (
    <Panel
      title={t('breakdown')}
      actions={
        <SegmentedLinks
          label={t('groupBy')}
          active={group}
          items={GROUPS.map((key) => ({
            key,
            href: withParam('/ai', params, { group: key }),
            label: t(`groups.${key}`),
          }))}
        />
      }
    >
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : result.data.length === 0 ? (
        <p className="text-bo-body text-ink-2">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-bo-table tabular-nums" data-testid="ai-breakdown">
            <caption className="sr-only">{t('breakdown')}</caption>
            <thead>
              <tr className="text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                  {t(`groups.${group}`)}
                </th>
                {(
                  [
                    'requests',
                    'inputTokens',
                    'outputTokens',
                    'cacheRead',
                    'cost',
                    'errorRate',
                    'p50',
                    'p95',
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t(`columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...result.data]
                .sort((a, b) => b.cost_usd - a.cost_usd)
                .map((row) => (
                  <tr key={row.key} className="border-t border-border-row">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink">
                      {keyLabel(row.key)}
                    </th>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.requests)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {f.number(row.input_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {f.number(row.output_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {f.number(row.cache_read_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.usd(row.cost_usd)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.percent(row.error_rate)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.duration(row.p50_ms)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.duration(row.p95_ms)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
