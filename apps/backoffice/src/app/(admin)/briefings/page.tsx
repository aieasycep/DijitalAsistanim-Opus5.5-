import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { KpiCard, Panel, ReadError, StatGrid } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { RangeLinks } from '@/components/range-links';
import { LoadingState } from '@/components/states/loading-state';
import { Card } from '@/components/ui/card';
import { hasAnyPermission } from '@/lib/admin-context';
import { METRIC_RANGES, parseRange, type MetricRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { BriefingsTable } from './briefings-table';

/*
 * Brifingler (BACKOFFICE_PLAN §6.7, §7.5; M§54, C-21; T-10.09): scheduled, generated, delivered,
 * failed and skipped counts with generation latency p50/p95, AI cost and the template-fallback rate,
 * overall and per briefing kind, then the briefing rows (never their text) with "Yeniden oluştur"
 * for today's failed or skipped ones.
 */

const KINDS = ['morning', 'midday', 'evening', 'weekly'] as const;
const FILTERS = ['kind', 'status', 'user_id', 'local_date'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.briefings');
  return { title: t('title') };
}

export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.briefings'),
    searchParams,
    loadAdminContext(),
  ]);
  const range = parseRange(params.range, METRIC_RANGES, '7d');
  const state = loadTableState(params, FILTERS);
  const showMetrics = hasAnyPermission(context.permissions, ['briefings.read', 'metrics.ops.read']);
  const result = await readAdmin('GET /briefings', {
    query: toAdminListQuery(state, {
      sortable: ['local_date', 'generated_at'],
      filterKeys: FILTERS,
      search: false,
      transform: {
        kind: firstValue,
        status: firstValue,
        user_id: firstValue,
        local_date: firstValue,
      },
    }),
  });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<RangeLinks path="/briefings" params={params} active={range} />}
      />
      {showMetrics ? (
        <Suspense key={range} fallback={<LoadingState rows={4} />}>
          <Metrics range={range} />
        </Suspense>
      ) : null}
      <BriefingsTable data={toTableData(result, { aggregatesVisible: showMetrics })} />
    </>
  );
}

async function Metrics({ range }: { range: MetricRange }) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.briefings'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const [total, ...perKind] = await Promise.all([
    readAdmin('GET /briefings/metrics', { query: { range } }),
    ...KINDS.map((kind) => readAdmin('GET /briefings/metrics', { query: { range, kind } })),
  ]);
  if (!total.ok) {
    return (
      <Card>
        <ReadError error={total.error} compact />
      </Card>
    );
  }
  const m = total.data;
  return (
    <div className="flex flex-col gap-4">
      <StatGrid label={t('metrics')} columns={5}>
        <KpiCard label={t('kpi.scheduled')} value={f.number(m.scheduled)} testId="brf-scheduled" />
        <KpiCard label={t('kpi.generated')} value={f.number(m.generated)} testId="brf-generated" />
        <KpiCard label={t('kpi.delivered')} value={f.number(m.delivered)} />
        <KpiCard
          label={t('kpi.failed')}
          value={f.number(m.failed)}
          tone={m.failed > 0 ? 'critical' : undefined}
          testId="brf-failed"
        />
        <KpiCard label={t('kpi.skipped')} value={f.number(m.skipped)} />
        <KpiCard label={t('kpi.p50')} value={f.duration(m.p50_latency_ms)} />
        <KpiCard label={t('kpi.p95')} value={f.duration(m.p95_latency_ms)} />
        <KpiCard label={t('kpi.cost')} value={f.usd(m.ai_cost_usd)} />
        <KpiCard label={t('kpi.fallback')} value={f.percent(m.template_fallback_rate)} />
      </StatGrid>
      <Panel title={t('perKind')}>
        <div className="overflow-x-auto">
          <table className="w-full text-bo-table tabular-nums" data-testid="briefings-per-kind">
            <caption className="sr-only">{t('perKind')}</caption>
            <thead>
              <tr className="text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                  {t('columns.kind')}
                </th>
                {(
                  [
                    'scheduled',
                    'generated',
                    'delivered',
                    'failed',
                    'skipped',
                    'p50',
                    'p95',
                    'cost',
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t(`kpi.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((kind, index) => {
                const row = perKind[index];
                return (
                  <tr key={kind} className="border-t border-border-row">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink">
                      {te(`briefingKind.${kind}`)}
                    </th>
                    {!row?.ok ? (
                      <td colSpan={8} className="py-1.5 text-right text-tone-critical-text">
                        {t('kindFailed')}
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.number(row.data.scheduled)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.number(row.data.generated)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.number(row.data.delivered)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.number(row.data.failed)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.number(row.data.skipped)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.duration(row.data.p50_latency_ms)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.duration(row.data.p95_latency_ms)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-ink">
                          {f.usd(row.data.ai_cost_usd)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
