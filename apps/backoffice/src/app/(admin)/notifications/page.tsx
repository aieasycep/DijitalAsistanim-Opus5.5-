import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { BarList, KpiCard, Panel, ReadError, StatGrid } from '@/components/module-kit';
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
import { NotificationsTable } from './notifications-table';
import { PushTestLauncher } from './push-test-launcher';

/*
 * Bildirimler (BACKOFFICE_PLAN §6.8; M§55, M§132; T-10.09): decisions (scheduled, sent, failed,
 * suppressed, deduplicated), suppression reasons and push receipt errors, then the decision rows
 * (category, decision and reason only, never the rendered text). The test push (`push.test`) is sent
 * from the user's page so the dialog can show the user's devices; it never bypasses quiet hours.
 */

const FILTERS = ['category', 'decision', 'user_id'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.notifications');
  return { title: t('title') };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.notifications'),
    searchParams,
    loadAdminContext(),
  ]);
  const range = parseRange(params.range, METRIC_RANGES, '7d');
  const state = loadTableState(params, FILTERS);
  const showMetrics = hasAnyPermission(context.permissions, [
    'notifications.read',
    'metrics.ops.read',
  ]);
  const result = await readAdmin('GET /notifications', {
    query: toAdminListQuery(state, {
      sortable: ['sent_at'],
      filterKeys: FILTERS,
      search: false,
      transform: { category: firstValue, decision: firstValue, user_id: firstValue },
    }),
  });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <RangeLinks path="/notifications" params={params} active={range} />
            {context.permissions.includes('push.test') ? <PushTestLauncher /> : null}
          </>
        }
      />
      {showMetrics ? (
        <Suspense key={range} fallback={<LoadingState rows={4} />}>
          <Metrics range={range} />
        </Suspense>
      ) : null}
      <NotificationsTable data={toTableData(result, { aggregatesVisible: showMetrics })} />
    </>
  );
}

async function Metrics({ range }: { range: MetricRange }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.notifications'), getFormatters()]);
  const result = await readAdmin('GET /notifications/metrics', { query: { range } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const m = result.data;
  const total = m.scheduled + m.sent + m.failed + m.suppressed + m.deduplicated;
  const reasonLabel = (key: string) =>
    t.has(`reasons.${key}` as never) ? t(`reasons.${key}` as never) : key;
  return (
    <div className="flex flex-col gap-4">
      <StatGrid label={t('metrics')} columns={3}>
        <KpiCard label={t('kpi.scheduled')} value={f.number(m.scheduled)} />
        <KpiCard label={t('kpi.sent')} value={f.number(m.sent)} testId="ntf-sent" />
        <KpiCard
          label={t('kpi.failed')}
          value={f.number(m.failed)}
          tone={m.failed > 0 ? 'critical' : undefined}
        />
        <KpiCard
          label={t('kpi.suppressed')}
          value={f.number(m.suppressed)}
          testId="ntf-suppressed"
        />
        <KpiCard label={t('kpi.deduplicated')} value={f.number(m.deduplicated)} />
        <KpiCard
          label={t('kpi.suppressionRate')}
          value={total === 0 ? '—' : f.percent((m.suppressed + m.deduplicated) / total)}
        />
      </StatGrid>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('suppressionReasons')}>
          <BarList
            label={t('suppressionReasons')}
            tone="warning"
            emptyText={t('noSuppression')}
            items={Object.entries(m.suppression_reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => ({
                key,
                label: reasonLabel(key),
                value,
                display: f.number(value),
              }))}
          />
        </Panel>
        <Panel title={t('receiptErrors')}>
          <BarList
            label={t('receiptErrors')}
            tone="critical"
            emptyText={t('noReceiptErrors')}
            items={Object.entries(m.receipt_errors)
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => ({ key, label: key, value, display: f.number(value) }))}
          />
        </Panel>
      </div>
    </div>
  );
}
