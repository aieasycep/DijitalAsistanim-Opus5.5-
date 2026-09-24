import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { BarList, Panel, ReadError } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { RangeLinks } from '@/components/range-links';
import { LoadingState } from '@/components/states/loading-state';
import { Card } from '@/components/ui/card';
import { METRIC_RANGES, parseRange, type MetricRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { FeedbackTable } from './feedback-table';

/*
 * Geri Bildirim (BACKOFFICE_PLAN §6.16; M§62, SREQ-71; T-10.12): feedback by type, rating, status
 * and app version, then the rows (type, rating, the message with emails and phone numbers
 * auto-masked, platform and version, status, assignee). Triage is L1; the raw message needs
 * `users.pii.reveal` and a reason.
 */

const FILTERS = ['type', 'status', 'platform', 'app_version', 'assignee'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.feedback');
  return { title: t('title') };
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.feedback'), searchParams]);
  const range = parseRange(params.range, METRIC_RANGES, '30d');
  const state = loadTableState(params, FILTERS);
  const result = await readAdmin('GET /feedback', {
    query: toAdminListQuery(state, {
      sortable: ['created_at', 'status'],
      filterKeys: FILTERS,
      transform: {
        type: firstValue,
        status: firstValue,
        platform: firstValue,
        app_version: firstValue,
        assignee: firstValue,
      },
    }),
  });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<RangeLinks path="/feedback" params={params} active={range} />}
      />
      <Suspense key={range} fallback={<LoadingState rows={4} />}>
        <Summary range={range} />
      </Suspense>
      <FeedbackTable data={toTableData(result)} />
    </>
  );
}

async function Summary({ range }: { range: MetricRange }) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.feedback'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /feedback/summary', { query: { range } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const s = result.data;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <Panel title={t('byType')}>
        <BarList
          label={t('byType')}
          emptyText={t('empty')}
          items={(['bug', 'feature', 'general', 'ai_quality'] as const).map((key) => ({
            key,
            label: te(`feedbackType.${key}`),
            value: s.by_type[key],
            display: f.number(s.by_type[key]),
          }))}
        />
      </Panel>
      <Panel title={t('byStatus')}>
        <BarList
          label={t('byStatus')}
          emptyText={t('empty')}
          items={(['new', 'triaged', 'planned', 'closed'] as const).map((key) => ({
            key,
            label: te(`feedbackStatus.${key}`),
            value: s.by_status[key],
            display: f.number(s.by_status[key]),
          }))}
        />
      </Panel>
      <Panel title={t('ratings')}>
        <BarList
          label={t('ratings')}
          tone="warning"
          emptyText={t('empty')}
          items={(['5', '4', '3', '2', '1'] as const).map((key) => ({
            key,
            label: t('stars', { count: Number(key) }),
            value: s.rating_distribution[key],
            display: f.number(s.rating_distribution[key]),
          }))}
        />
      </Panel>
      <Panel title={t('byVersion')}>
        <BarList
          label={t('byVersion')}
          emptyText={t('empty')}
          items={s.by_app_version.map((row) => ({
            key: row.app_version,
            label: row.app_version,
            value: row.count,
            display: f.number(row.count),
          }))}
        />
      </Panel>
    </div>
  );
}
