import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { AccountActions } from '@/components/account-actions';
import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import {
  BarList,
  KeyValueList,
  KpiCard,
  Panel,
  ReadError,
  StatGrid,
  withParam,
} from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { hasAnyPermission } from '@/lib/admin-context';
import { UUID_PATTERN } from '@/lib/ids';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { IntegrationsTable } from './integrations-table';

/*
 * Entegrasyonlar (BACKOFFICE_PLAN §6.5, M§52; T-10.08): the provider × status summary and the
 * account list with the M§52 status filters (healthy, needs reconnect, OAuth or refresh error, watch
 * issues), stalest sync first. `?account=<id>` opens the account panel (granted scopes, per-resource
 * sync state, recent jobs, webhook stats) with its actions. No token or ciphertext is ever returned.
 */

const FILTERS = ['provider', 'status', 'issue'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.integrations');
  return { title: t('title') };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.integrations'),
    searchParams,
    loadAdminContext(),
  ]);
  const state = loadTableState(params, FILTERS);
  const account =
    typeof params.account === 'string' && UUID_PATTERN.test(params.account) ? params.account : null;
  const result = await readAdmin('GET /integrations', {
    query: toAdminListQuery(state, {
      sortable: ['last_sync_at', 'status', 'provider'],
      filterKeys: FILTERS,
      transform: { provider: firstValue, status: firstValue, issue: firstValue },
    }),
  });
  const showSummary = hasAnyPermission(context.permissions, [
    'integrations.read',
    'metrics.ops.read',
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {showSummary ? (
        <Suspense fallback={<LoadingState rows={3} />}>
          <Summary />
        </Suspense>
      ) : null}
      {account === null ? null : (
        <Suspense fallback={<LoadingState rows={4} />}>
          <AccountPanel
            accountId={account}
            closeHref={withParam('/integrations', params, { account: null })}
          />
        </Suspense>
      )}
      <IntegrationsTable
        data={toTableData(result, { aggregatesVisible: showSummary })}
        {...(account === null ? {} : { selectedId: account })}
      />
    </>
  );
}

async function Summary() {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.integrations'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const result = await readAdmin('GET /integrations/summary', { query: { range: '7d' } });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  const data = result.data;
  const healthy = data.by_provider_status
    .filter((row) => row.status === 'healthy' || row.status === 'syncing')
    .reduce((sum, row) => sum + row.count, 0);
  const reconnect = data.by_provider_status
    .filter((row) => row.status === 'needs_reauth' || row.status === 'admin_consent_required')
    .reduce((sum, row) => sum + row.count, 0);
  const errors = data.by_provider_status
    .filter((row) => row.status === 'error' || row.status === 'partial')
    .reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flex flex-col gap-4">
      <StatGrid label={t('summary')} columns={5}>
        <KpiCard label={t('kpi.healthy')} value={f.number(healthy)} testId="int-healthy" />
        <KpiCard
          label={t('kpi.reconnect')}
          value={f.number(reconnect)}
          tone={reconnect > 0 ? 'warning' : undefined}
          testId="int-reconnect"
        />
        <KpiCard
          label={t('kpi.errors')}
          value={f.number(errors)}
          tone={errors > 0 ? 'critical' : undefined}
        />
        <KpiCard
          label={t('kpi.watchesExpiring')}
          value={f.number(data.watches_expiring_24h)}
          hint={t('kpi.renewalsFailed', { count: data.watch_renewals_failed_24h })}
        />
        <KpiCard
          label={t('kpi.reconnectRate')}
          value={f.percent(data.reconnect_rate)}
          hint={t('kpi.oldestSync', { time: f.dateTime(data.oldest_healthy_last_sync_at) })}
        />
      </StatGrid>
      <Panel title={t('matrix')}>
        <BarList
          label={t('matrix')}
          emptyText={t('empty')}
          items={data.by_provider_status.map((row) => ({
            key: `${row.provider}-${row.status}`,
            label: `${te(`provider.${row.provider}`)} · ${te(`accountStatus.${row.status}`)}`,
            value: row.count,
            display: f.number(row.count),
          }))}
        />
      </Panel>
    </div>
  );
}

async function AccountPanel({ accountId, closeHref }: { accountId: string; closeHref: string }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.integrations'), getFormatters()]);
  const result = await readAdmin('GET /integrations/:accountId', { params: { accountId } });
  return (
    <Panel
      title={t('detail.title')}
      testId="integration-detail"
      actions={
        <>
          {result.ok ? (
            <AccountActions
              userId={result.data.account.user_id}
              accountId={accountId}
              status={result.data.account.status}
              provider={result.data.account.provider}
            />
          ) : null}
          <Link
            href={closeHref}
            className="text-bo-body font-semibold text-text-link hover:underline"
          >
            {t('detail.close')}
          </Link>
        </>
      }
    >
      {result.ok ? (
        <div className="flex flex-col gap-4">
          <KeyValueList
            columns={3}
            items={[
              { label: t('columns.account'), value: accountId, mono: true },
              {
                label: t('columns.user'),
                value: (
                  <Link
                    href={`/users/${result.data.account.user_id}/integrations`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {result.data.account.user_id.slice(0, 8)}
                  </Link>
                ),
              },
              {
                label: t('columns.provider'),
                value: <EnumLabel group="provider" value={result.data.account.provider} />,
              },
              { label: t('columns.email'), value: result.data.account.email_masked ?? '—' },
              {
                label: t('columns.status'),
                value: <StatusBadge group="accountStatus" value={result.data.account.status} />,
              },
              {
                label: t('columns.error'),
                value: result.data.account.last_error_code ?? '—',
                mono: true,
              },
              {
                label: t('detail.scopes'),
                value: result.data.granted_scopes.join(', ') || '—',
                mono: true,
              },
              {
                label: t('detail.webhooks'),
                value: t('detail.webhookStats', {
                  received: result.data.webhook_stats.received_24h,
                  unmatched: result.data.webhook_stats.unmatched_24h,
                }),
              },
              {
                label: t('detail.lastWebhook'),
                value: f.dateTime(result.data.webhook_stats.last_received_at),
              },
            ]}
          />
          <table className="w-full text-bo-table tabular-nums">
            <caption className="pb-1 text-left text-bo-kicker text-ink-3 uppercase">
              {t('detail.syncStates')}
            </caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('detail.resource')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('columns.status')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('detail.lastSuccess')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('columns.error')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('columns.watch')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.data.sync_states.map((row) => (
                <tr key={row.resource} className="border-t border-border-row">
                  <td className="py-1.5 pr-3 text-ink">{row.resource}</td>
                  <td className="py-1.5 pr-3 text-ink">{row.status}</td>
                  <td className="py-1.5 pr-3 text-ink">{f.dateTime(row.last_success_at)}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">{row.last_error_code ?? '—'}</td>
                  <td className="py-1.5 text-ink">{f.dateTime(row.watch_expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-1">
            <p className="text-bo-kicker text-ink-3 uppercase">{t('detail.jobs')}</p>
            <ul className="flex flex-col gap-1">
              {result.data.recent_jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2 text-bo-table">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {job.id.slice(0, 8)}
                  </Link>
                  <EnumLabel group="jobType" value={job.type} />
                  <StatusBadge group="jobStatus" value={job.status} />
                  <span className="text-ink-3">{f.dateTime(job.created_at)}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`/jobs?f.account_id=${accountId}`}
              className="text-bo-body font-semibold text-text-link hover:underline"
            >
              {t('detail.allJobs')}
            </Link>
          </div>
        </div>
      ) : (
        <ReadError error={result.error} compact />
      )}
    </Panel>
  );
}
