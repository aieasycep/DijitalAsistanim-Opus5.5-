import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { KeyValueList, KpiCard, Panel, ReadError, StatGrid, TabNav } from '@/components/module-kit';
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
import { ReferralsTable } from './referrals-table';

/*
 * Davetler (BACKOFFICE_PLAN §6.15, §7.5; M§45, M§62; P-06; T-10.11): invites, sign-ups, qualified
 * and rewarded referrals, conversion, bonus days and abuse flags; the referral list and the flagged
 * review queue (approve / reject with a reason). Anti-abuse signals appear as labels only; the
 * reward rules are shown read-only and edited in Settings › Sistem.
 */

const TABS = ['overview', 'list', 'flagged'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.referrals');
  return { title: t('title') };
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.referrals'),
    searchParams,
    loadAdminContext(),
  ]);
  const tab = parseRange(params.tab, TABS, 'overview');
  const range = parseRange(params.range, METRIC_RANGES, '30d');
  const showMetrics = hasAnyPermission(context.permissions, [
    'referrals.read',
    'metrics.product.read',
  ]);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          tab === 'overview' ? (
            <RangeLinks path="/referrals" params={params} active={range} />
          ) : undefined
        }
      />
      <TabNav
        label={t('tabs.label')}
        active={tab}
        items={TABS.map((key) => ({
          key,
          href: key === 'overview' ? '/referrals' : `/referrals?tab=${key}`,
          label: t(`tabs.${key}`),
        }))}
      />
      {tab === 'overview' ? (
        showMetrics ? (
          <Suspense key={range} fallback={<LoadingState rows={4} />}>
            <Overview range={range} />
          </Suspense>
        ) : null
      ) : (
        <List params={params} flagged={tab === 'flagged'} aggregatesVisible={showMetrics} />
      )}
    </>
  );
}

async function Overview({ range }: { range: MetricRange }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.referrals'), getFormatters()]);
  const [metrics, settings] = await Promise.all([
    readAdmin('GET /referrals/metrics', { query: { range } }),
    readAdmin('GET /settings'),
  ]);
  const config = settings.ok ? settings.data.app_settings : null;
  const setting = (key: string) => {
    const value = config?.[key];
    return typeof value === 'number' || typeof value === 'string' ? String(value) : '—';
  };
  return (
    <div className="flex flex-col gap-4">
      {metrics.ok ? (
        <StatGrid label={t('metrics')}>
          <KpiCard label={t('kpi.invites')} value={f.number(metrics.data.invites)} />
          <KpiCard label={t('kpi.signups')} value={f.number(metrics.data.signups)} />
          <KpiCard label={t('kpi.qualified')} value={f.number(metrics.data.qualified)} />
          <KpiCard
            label={t('kpi.rewarded')}
            value={f.number(metrics.data.rewarded)}
            testId="ref-rewarded"
          />
          <KpiCard label={t('kpi.conversion')} value={f.percent(metrics.data.conversion)} />
          <KpiCard label={t('kpi.bonusDays')} value={f.number(metrics.data.bonus_days_granted)} />
          <KpiCard
            label={t('kpi.flagged')}
            value={f.number(metrics.data.flagged)}
            tone={metrics.data.flagged > 0 ? 'warning' : undefined}
            hint={
              metrics.data.flagged > 0 ? (
                <Link href="/referrals?tab=flagged" className="text-text-link hover:underline">
                  {t('reviewFlagged')}
                </Link>
              ) : undefined
            }
          />
        </StatGrid>
      ) : (
        <Card>
          <ReadError error={metrics.error} />
        </Card>
      )}
      <Panel title={t('rules')} description={t('rulesHint')}>
        <KeyValueList
          columns={3}
          items={[
            { label: t('rule.maxPerYear'), value: setting('referral.max_rewards_per_year') },
            { label: t('rule.rewardDays'), value: setting('referral.reward_days') },
            { label: t('rule.riskThreshold'), value: setting('referral.risk_threshold') },
            { label: t('rule.applyWindow'), value: setting('referral.apply_window_days') },
          ]}
        />
      </Panel>
    </div>
  );
}

const FILTERS = ['status'] as const;

async function List({
  params,
  flagged,
  aggregatesVisible,
}: {
  params: Record<string, string | string[] | undefined>;
  flagged: boolean;
  aggregatesVisible: boolean;
}) {
  const state = loadTableState(params, FILTERS);
  const query = toAdminListQuery(state, {
    sortable: ['created_at', 'risk_score'],
    filterKeys: FILTERS,
    transform: { status: firstValue },
  });
  if (flagged) query['filter[status]'] = 'flagged';
  const result = await readAdmin('GET /referrals', { query });
  return <ReferralsTable data={toTableData(result, { aggregatesVisible })} flagged={flagged} />;
}
