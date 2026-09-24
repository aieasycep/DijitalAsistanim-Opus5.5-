import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { Panel, ReadError, SegmentedLinks, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { RangeLinks } from '@/components/range-links';
import { LoadingState } from '@/components/states/loading-state';
import { hasAnyPermission } from '@/lib/admin-context';
import { METRIC_RANGES, parseRange, type MetricRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { PromptTabs } from '../ai-tabs';
import { AiFeedbackTable } from './feedback-table';

/*
 * AI Geri Bildirimi (BACKOFFICE_PLAN §6.12; M§59, SREQ-83; T-10.10): positive / negative counts and
 * the positive rate by feature, model or prompt version, then the rows with the comment hidden
 * ("Gizli"); `ai_feedback.reveal` shows it for 60 s with a reason (audited). No link to the source
 * content exists.
 */

const GROUPS = ['feature', 'model', 'prompt_version'] as const;
const FILTERS = ['feature', 'rating', 'prompt_version'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.aiFeedback');
  return { title: t('title') };
}

export default async function AiFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.aiFeedback'),
    searchParams,
    loadAdminContext(),
  ]);
  const range = parseRange(params.range, METRIC_RANGES, '30d');
  const group = parseRange(params.group, GROUPS, 'feature');
  const state = loadTableState(params, FILTERS);
  const showAggregates = hasAnyPermission(context.permissions, [
    'ai_feedback.read',
    'metrics.ai.read',
  ]);
  const result = await readAdmin('GET /ai/feedback', {
    query: toAdminListQuery(state, {
      sortable: ['created_at'],
      filterKeys: FILTERS,
      search: false,
      transform: { feature: firstValue, rating: firstValue, prompt_version: firstValue },
    }),
  });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<RangeLinks path="/ai/feedback" params={params} active={range} />}
      />
      <PromptTabs active="feedback" />
      {showAggregates ? (
        <Suspense key={`${range}-${group}`} fallback={<LoadingState rows={4} />}>
          <Aggregates range={range} group={group} params={params} />
        </Suspense>
      ) : null}
      <AiFeedbackTable data={toTableData(result, { aggregatesVisible: showAggregates })} />
    </>
  );
}

async function Aggregates({
  range,
  group,
  params,
}: {
  range: MetricRange;
  group: (typeof GROUPS)[number];
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.aiFeedback'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /ai/feedback/aggregates', {
    query: { range, group_by: group },
  });
  return (
    <Panel
      title={t('aggregates')}
      actions={
        <SegmentedLinks
          label={t('groupBy')}
          active={group}
          items={GROUPS.map((key) => ({
            key,
            href: withParam('/ai/feedback', params, { group: key }),
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
        <table className="w-full text-bo-table tabular-nums" data-testid="ai-feedback-aggregates">
          <caption className="sr-only">{t('aggregates')}</caption>
          <thead>
            <tr className="text-bo-meta text-ink-2">
              <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                {t(`groups.${group}`)}
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                {t('positive')}
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                {t('negative')}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                {t('rate')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((row) => (
              <tr key={row.key} className="border-t border-border-row">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink">
                  {group === 'feature' && te.has(`aiFeature.${row.key}` as never)
                    ? te(`aiFeature.${row.key}` as never)
                    : row.key}
                </th>
                <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.positive)}</td>
                <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.negative)}</td>
                <td className="py-1.5 text-right text-ink">{f.percent(row.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
