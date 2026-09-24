import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import {
  dayBound,
  firstValue,
  loadTableState,
  toAdminListQuery,
} from '@/components/data-table/url-state';
import { BarList, KpiCard, Panel, ReadError, StatGrid } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { hasAnyPermission } from '@/lib/admin-context';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { BulkRetryButton } from './bulk-retry';
import { JOB_FILTERS } from './config';
import { JobsTable } from './jobs-table';

/*
 * Senkron ve İşler (BACKOFFICE_PLAN §6.6, M§53, M§127; T-10.08): the 24-hour job summary by status
 * and type, the dead-letter count and the server-paginated job list (status, type, user, account,
 * time range). Retry follows the per-type policy, cancel applies to queued/retrying jobs, and the
 * bulk retry works on a type + status + time window (L3 above 10 jobs).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.jobs');
  return { title: t('title') };
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.jobs'),
    searchParams,
    loadAdminContext(),
  ]);
  const state = loadTableState(params, JOB_FILTERS);
  const canList = context.permissions.includes('jobs.read');
  const showStats = hasAnyPermission(context.permissions, ['jobs.read', 'metrics.ops.read']);
  const result = await readAdmin('GET /jobs', {
    query: toAdminListQuery(state, {
      sortable: ['created_at', 'run_after', 'attempts'],
      filterKeys: JOB_FILTERS,
      transform: {
        type: firstValue,
        status: firstValue,
        user_id: firstValue,
        account_id: firstValue,
        from: dayBound('from'),
        to: dayBound('to'),
      },
    }),
  });
  const deadOnly = state['f.status']?.[0] === 'dead_letter';
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link
              href={deadOnly ? '/jobs' : '/jobs?f.status=dead_letter'}
              aria-current={deadOnly ? 'page' : undefined}
              className={buttonVariants({
                variant: deadOnly ? 'primary' : 'secondary',
                size: 'sm',
              })}
            >
              {t('deadOnly')}
            </Link>
            {context.permissions.includes('jobs.retry') ? <BulkRetryButton /> : null}
          </>
        }
      />
      {showStats ? (
        <Suspense fallback={<LoadingState rows={3} />}>
          <Stats />
        </Suspense>
      ) : null}
      <JobsTable
        data={toTableData(result, { aggregatesVisible: showStats && !canList })}
        deadOnly={deadOnly}
      />
    </>
  );
}

async function Stats() {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.jobs'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /jobs/stats', { query: { range: '24h' } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const byStatus = new Map<string, number>();
  const byType = new Map<string, { failed: number; total: number }>();
  for (const row of result.data.by_type_status) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
    const type = byType.get(row.type) ?? { failed: 0, total: 0 };
    type.total += row.count;
    if (row.status === 'failed' || row.status === 'dead_letter') type.failed += row.count;
    byType.set(row.type, type);
  }
  const statuses = ['queued', 'running', 'retrying', 'failed', 'completed'] as const;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
      <StatGrid label={t('stats')} columns={3}>
        {statuses.map((status) => (
          <KpiCard
            key={status}
            label={te(`jobStatus.${status}`)}
            value={f.number(byStatus.get(status) ?? 0)}
            testId={`jobs-${status}`}
          />
        ))}
        <KpiCard
          label={te('jobStatus.dead_letter')}
          value={f.number(result.data.dead_letter)}
          tone={result.data.dead_letter > 0 ? 'critical' : undefined}
          testId="jobs-dead_letter"
        />
      </StatGrid>
      <Panel title={t('failureByType')}>
        <BarList
          label={t('failureByType')}
          tone="critical"
          emptyText={t('noFailures')}
          items={[...byType.entries()]
            .filter(([, value]) => value.failed > 0)
            .sort((a, b) => b[1].failed - a[1].failed)
            .map(([type, value]) => ({
              key: type,
              label: te.has(`jobType.${type}` as never) ? te(`jobType.${type}` as never) : type,
              value: value.failed,
              display: `${f.number(value.failed)} · ${f.percent(value.failed / Math.max(1, value.total))}`,
            }))}
        />
      </Panel>
    </div>
  );
}
