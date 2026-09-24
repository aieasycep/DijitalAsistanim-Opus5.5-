import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { KeyValueList, Panel, ReadError, TabNav, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { UUID_PATTERN } from '@/lib/ids';
import { parseRange } from '@/lib/ranges';
import { toTableData } from '@/lib/read-result';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { DataRequestActions } from './data-request-actions';
import { DataRequestsTable } from './data-requests-table';

/*
 * Veri Talepleri (BACKOFFICE_PLAN §6.19; M§65, M§128, M§129; F-06; T-10.13): exports, history
 * deletions and account deletions with the DB `export_status` / `deletion_status`, the step progress
 * and the request age against the 30-day window. A failed request is retried from its first
 * incomplete step; an expired or failed export is regenerated. The backoffice never marks a request
 * completed, never sees export contents or signed URLs, and shows deleted users only by hash prefix.
 */

const TABS = ['exports', 'history_deletion', 'account_deletion'] as const;
type Tab = (typeof TABS)[number];
const KIND: Readonly<Record<Tab, 'export' | 'history_deletion' | 'account_deletion'>> = {
  exports: 'export',
  history_deletion: 'history_deletion',
  account_deletion: 'account_deletion',
};
const FILTERS = ['status'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.dataRequests');
  return { title: t('title') };
}

export default async function DataRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.dataRequests'), searchParams]);
  const tab = parseRange(params.tab, TABS, 'exports');
  const state = loadTableState(params, FILTERS);
  const requestId =
    typeof params.request === 'string' && UUID_PATTERN.test(params.request) ? params.request : null;
  const result = await readAdmin('GET /data-requests', {
    query: {
      ...toAdminListQuery(state, {
        sortable: ['requested_at', 'completed_at'],
        filterKeys: FILTERS,
        search: false,
        transform: { status: firstValue },
      }),
      tab,
    },
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TabNav
        label={t('tabs.label')}
        active={tab}
        items={TABS.map((key) => ({
          key,
          href: key === 'exports' ? '/data-requests' : `/data-requests?tab=${key}`,
          label: t(`tabs.${key}`),
        }))}
      />
      {requestId === null ? null : (
        <Suspense key={requestId} fallback={<LoadingState rows={6} />}>
          <RequestPanel
            kind={KIND[tab]}
            id={requestId}
            closeHref={withParam('/data-requests', params, { request: null })}
          />
        </Suspense>
      )}
      <DataRequestsTable
        data={toTableData(result)}
        tab={tab}
        {...(requestId === null ? {} : { selectedId: requestId })}
      />
    </>
  );
}

async function RequestPanel({
  kind,
  id,
  closeHref,
}: {
  kind: 'export' | 'history_deletion' | 'account_deletion';
  id: string;
  closeHref: string;
}) {
  const [t, f] = await Promise.all([getTranslations('backoffice.dataRequests'), getFormatters()]);
  const result = await readAdmin('GET /data-requests/:kind/:id', { params: { kind, id } });
  return (
    <Panel
      title={t('detail.title')}
      testId="data-request-detail"
      actions={
        <>
          {result.ok ? (
            <DataRequestActions
              kind={kind}
              id={id}
              status={result.data.status}
              origin={result.data.origin}
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
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : (
        <div className="flex flex-col gap-4">
          <KeyValueList
            columns={3}
            items={[
              { label: t('columns.id'), value: result.data.id, mono: true },
              { label: t('columns.user'), value: result.data.user_ref, mono: true },
              {
                label: t('columns.origin'),
                value: <EnumLabel group="origin" value={result.data.origin} />,
              },
              {
                label: t('columns.status'),
                value: <StatusBadge group="requestStatus" value={result.data.status} />,
              },
              { label: t('columns.requested'), value: f.dateTime(result.data.requested_at) },
              { label: t('columns.completed'), value: f.dateTime(result.data.completed_at) },
              {
                label: t('detail.job'),
                value:
                  result.data.job === null ? (
                    '—'
                  ) : (
                    <Link
                      href={`/jobs/${result.data.job.id}`}
                      className="font-mono text-text-link hover:underline"
                    >
                      {result.data.job.id.slice(0, 8)} · {result.data.job.status}
                    </Link>
                  ),
              },
            ]}
          />
          {result.data.origin === 'web_otp' && result.data.status === 'requested' ? (
            <p className="text-bo-body text-tone-warning-text">{t('awaitingEmail')}</p>
          ) : null}
          <ol
            className="flex flex-col gap-2"
            aria-label={t('detail.steps')}
            data-testid="data-request-steps"
          >
            {result.data.steps.map((step) => (
              <li
                key={step.step}
                className="flex flex-wrap items-center gap-2 border-l-2 border-border-strong pl-3 text-bo-table"
              >
                <span className="font-mono text-ink">{step.step}</span>
                <StatusBadge group="stepStatus" value={step.status} />
                {step.detail_code === null ? null : (
                  <span className="font-mono text-ink-3">{step.detail_code}</span>
                )}
                <span className="text-ink-3">{f.dateTime(step.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
