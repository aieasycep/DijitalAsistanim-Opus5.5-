import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { AuditTable } from '@/components/audit-table';
import { loadTableState } from '@/components/data-table/url-state';
import { Icon } from '@/components/icon';
import { KeyValueList, Panel, ReadError, SegmentedLinks, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { AUDIT_FILTERS, auditQuery } from '@/lib/audit-query';
import { UUID_PATTERN } from '@/lib/ids';
import { toTableData } from '@/lib/read-result';
import { auditActions } from '@/server/admin-contracts';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';

/*
 * Denetim Kayıtları (BACKOFFICE_PLAN §6.20, §10; M§66; T-10.13): time, admin, role, action, target,
 * reason, result and correlation id, newest first, with the §6.20 filters; a row opens its detail
 * (metadata, hash chain position). "Zinciri doğrula" checks the hash chain over a window and shows a
 * critical banner at the first broken entry. There is no edit, delete, export or purge anywhere.
 */

const VERIFY_WINDOWS = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
type VerifyWindow = keyof typeof VERIFY_WINDOWS;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.audit');
  return { title: t('title') };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getTranslations('backoffice.audit'), searchParams]);
  const state = loadTableState(params, AUDIT_FILTERS);
  const selected = typeof params.id === 'string' && UUID_PATTERN.test(params.id) ? params.id : null;
  const verify =
    typeof params.verify === 'string' && params.verify in VERIFY_WINDOWS
      ? (params.verify as VerifyWindow)
      : null;
  const result = await readAdmin('GET /audit', { query: auditQuery(state) });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <SegmentedLinks
            label={t('verify.label')}
            active={verify ?? ''}
            items={(Object.keys(VERIFY_WINDOWS) as VerifyWindow[]).map((key) => ({
              key,
              href: withParam('/audit', params, { verify: key }),
              label: t(`verify.r${key}`),
            }))}
          />
        }
      />
      {verify === null ? null : (
        <Suspense key={verify} fallback={<LoadingState rows={1} />}>
          <VerifyBanner span={verify} />
        </Suspense>
      )}
      {selected === null ? null : (
        <Suspense key={selected} fallback={<LoadingState rows={6} />}>
          <AuditDetail id={selected} closeHref={withParam('/audit', params, { id: null })} />
        </Suspense>
      )}
      <AuditTable
        data={toTableData(result)}
        actions={auditActions()}
        tableId="audit"
        {...(selected === null ? {} : { selectedId: selected })}
      />
    </>
  );
}

async function VerifyBanner({ span }: { span: VerifyWindow }) {
  const t = await getTranslations('backoffice.audit.verify');
  const to = new Date();
  const from = new Date(to.getTime() - VERIFY_WINDOWS[span]);
  const result = await readAdmin('GET /audit/verify-chain', {
    query: { from: from.toISOString(), to: to.toISOString() },
  });
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} compact />
      </Card>
    );
  }
  if (result.data.verified) {
    return (
      <p
        role="status"
        data-testid="audit-verified"
        className="flex items-center gap-2 rounded-card-sm bg-tone-success-soft p-4 text-bo-body text-tone-success-text"
      >
        <Icon name="check_circle" size={16} />
        {t('ok', { window: t(`r${span}`) })}
      </p>
    );
  }
  return (
    <p
      role="alert"
      data-testid="audit-broken"
      className="flex items-center gap-2 rounded-card-sm bg-tone-critical-soft p-4 text-bo-body font-semibold text-tone-critical-text-strong"
    >
      <Icon name="error" size={16} />
      {t('broken', { id: result.data.first_broken_id ?? '—' })}
    </p>
  );
}

async function AuditDetail({ id, closeHref }: { id: string; closeHref: string }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.audit'), getFormatters()]);
  const result = await readAdmin('GET /audit/:id', { params: { id } });
  return (
    <Panel
      title={t('detail.title')}
      testId="audit-detail"
      actions={
        <Link
          href={closeHref}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('detail.close')}
        </Link>
      }
    >
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : (
        <div className="flex flex-col gap-3">
          <KeyValueList
            columns={3}
            items={[
              { label: t('columns.time'), value: f.dateTime(result.data.ts) },
              { label: t('detail.sequence'), value: f.number(result.data.chain_seq) },
              { label: t('detail.actorType'), value: result.data.actor_type },
              { label: t('columns.admin'), value: result.data.actor },
              { label: t('columns.role'), value: result.data.role ?? '—' },
              { label: t('columns.action'), value: result.data.action, mono: true },
              { label: t('detail.targetType'), value: result.data.target_type ?? '—', mono: true },
              { label: t('detail.targetId'), value: result.data.target_id ?? '—', mono: true },
              { label: t('detail.targetUser'), value: result.data.target_user ?? '—', mono: true },
              { label: t('columns.reason'), value: result.data.reason ?? '—' },
              {
                label: t('columns.result'),
                value: <StatusBadge group="auditResult" value={result.data.result} />,
              },
              {
                label: t('columns.correlation'),
                value: result.data.correlation_id ?? '—',
                mono: true,
              },
              {
                label: t('detail.prevHash'),
                value: result.data.prev_hash?.slice(0, 16) ?? '—',
                mono: true,
              },
              { label: t('detail.hash'), value: result.data.hash.slice(0, 16), mono: true },
            ]}
          />
          <section className="flex flex-col gap-1">
            <h3 className="text-bo-kicker text-ink-3 uppercase">{t('detail.metadata')}</h3>
            <pre className="max-h-64 overflow-auto rounded-tile bg-surface-sunken p-3 font-mono text-bo-mono whitespace-pre-wrap text-ink">
              {JSON.stringify(result.data.metadata, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </Panel>
  );
}
