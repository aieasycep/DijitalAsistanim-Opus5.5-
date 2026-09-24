import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { HEALTH_PROBE_VALUES } from '@da/validation/admin/system';
import { Panel, ReadError, SegmentedLinks, TabNav, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { serverEnv } from '@/env';
import { cn } from '@/lib/cn';
import { effectiveStatus, isStale, overallHealth } from '@/lib/health';
import { parseRange } from '@/lib/ranges';
import { requestTime } from '@/server/clock';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { RunProbesButton } from './run-probes';

/*
 * Sistem Sağlığı (BACKOFFICE_PLAN §6.21, §6.22, §11; M§67, M§110; T-10.14): the real probe results,
 * never green by default (a probe older than 10 minutes is "Bilinmiyor"), services without their
 * credential listed separately as "Yapılandırılmadı — Harici kimlik bilgisi gerekli", credential
 * expiries, "Şimdi çalıştır", a probe's history; app versions with installs, sync-error rate and old
 * versions; and the cron schedules with the worker lag.
 */

const TABS = ['probes', 'versions', 'cron'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.health');
  return { title: t('title') };
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.health'),
    searchParams,
    loadAdminContext(),
  ]);
  const tab = parseRange(params.tab, TABS, 'probes');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          tab === 'probes' && context.permissions.includes('health.run') ? (
            <RunProbesButton />
          ) : undefined
        }
      />
      <TabNav
        label={t('tabs.label')}
        active={tab}
        items={TABS.map((key) => ({
          key,
          href: key === 'probes' ? '/health' : `/health?tab=${key}`,
          label: t(`tabs.${key}`),
        }))}
      />
      <Suspense key={`${tab}-${JSON.stringify(params)}`} fallback={<LoadingState rows={8} />}>
        {tab === 'probes' ? <Probes params={params} /> : null}
        {tab === 'versions' ? <Versions params={params} /> : null}
        {tab === 'cron' ? <Cron /> : null}
      </Suspense>
    </>
  );
}

async function Probes({ params }: { params: Record<string, string | string[] | undefined> }) {
  const [t, f] = await Promise.all([getTranslations('backoffice.health'), getFormatters()]);
  const result = await readAdmin('GET /health/summary');
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} />
      </Card>
    );
  }
  const now = requestTime();
  const components = result.data.components;
  const configured = components.filter((c) => c.status !== 'external_credential_required');
  const missing = components.filter((c) => c.status === 'external_credential_required');
  const overall = overallHealth(components, now, serverEnv().APP_ENV === 'production');
  const component = HEALTH_PROBE_VALUES.find((p) => p === params.component) ?? null;
  const tone =
    overall === 'outage' ? 'critical' : overall === 'operational' ? 'success' : 'warning';
  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        data-testid="health-overall"
        className={cn(
          'rounded-card-sm p-4 text-h3',
          tone === 'critical' && 'bg-tone-critical-soft text-tone-critical-text-strong',
          tone === 'warning' && 'bg-tone-warning-soft text-tone-warning-text',
          tone === 'success' && 'bg-tone-success-soft text-tone-success-text',
        )}
      >
        {t(`overall.${overall}`)}
      </p>
      <Panel title={t('probes')}>
        {configured.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noProbes')}</p>
        ) : (
          <table className="w-full text-bo-table tabular-nums" data-testid="health-probes">
            <caption className="sr-only">{t('probes')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('columns.component')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('columns.status')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  {t('columns.latency')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('columns.checked')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('columns.detail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {configured.map((probe) => {
                const status = effectiveStatus(probe, now);
                return (
                  <tr
                    key={probe.component}
                    className="border-t border-border-row"
                    data-testid={`probe-${probe.component}`}
                  >
                    <td className="py-1.5 pr-3">
                      <Link
                        href={withParam('/health', params, { component: probe.component })}
                        className="text-text-link hover:underline"
                      >
                        <EnumLabel group="healthProbe" value={probe.component} />
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge group="healthStatus" value={status} />
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {f.duration(probe.latency_ms)}
                    </td>
                    <td className="py-1.5 pr-3 text-ink">
                      {isStale(probe.checked_at, now)
                        ? t('lastCheck', { relative: f.relative(probe.checked_at, now) })
                        : f.dateTime(probe.checked_at)}
                    </td>
                    <td className="py-1.5 font-mono text-ink-2">{probe.detail_code ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('notConfiguredTitle')}>
          {missing.length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('allConfigured')}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="health-missing">
              {missing.map((probe) => (
                <li
                  key={probe.component}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-bo-body text-ink">
                    <EnumLabel group="healthProbe" value={probe.component} />
                  </span>
                  <span className="text-bo-meta text-ink-2">{t('notConfiguredRow')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('expiry')}>
          {result.data.credential_expiry.length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('noExpiry')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.data.credential_expiry.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center justify-between gap-2 text-bo-table"
                >
                  <span className="font-mono text-ink">{row.key}</span>
                  <span
                    className={cn(
                      'text-ink-2',
                      row.days_left !== null &&
                        row.days_left <= 30 &&
                        'font-semibold text-tone-warning-text',
                    )}
                  >
                    {row.not_after === null
                      ? '—'
                      : t('expires', { date: f.dateTime(row.not_after), days: row.days_left ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {component === null ? null : <History component={component} params={params} />}
    </div>
  );
}

async function History({
  component,
  params,
}: {
  component: (typeof HEALTH_PROBE_VALUES)[number];
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.health'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const range = parseRange(params.hrange, ['24h', '7d', '30d'] as const, '24h');
  const result = await readAdmin('GET /health/history', { query: { component, range } });
  return (
    <Panel
      title={t('history', { component: te(`healthProbe.${component}`) })}
      testId="health-history"
      actions={
        <>
          <SegmentedLinks
            label={t('historyRange')}
            active={range}
            items={(['24h', '7d', '30d'] as const).map((key) => ({
              key,
              href: withParam('/health', params, { hrange: key }),
              label: t(`ranges.r${key}`),
            }))}
          />
          <Link
            href={withParam('/health', params, { component: null, hrange: null })}
            className="text-bo-body font-semibold text-text-link hover:underline"
          >
            {t('closeHistory')}
          </Link>
        </>
      }
    >
      {!result.ok ? (
        <ReadError error={result.error} compact />
      ) : result.data.length === 0 ? (
        <p className="text-bo-body text-ink-2">{t('noHistory')}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {result.data.map((row) => (
            <li
              key={`${row.checked_at}-${row.checked_by}`}
              className="flex flex-wrap items-center gap-2 text-bo-table"
            >
              <span className="text-ink-3">{f.dateTime(row.checked_at)}</span>
              <StatusBadge group="healthStatus" value={row.status} />
              <span className="text-ink">{f.duration(row.latency_ms)}</span>
              <span className="font-mono text-ink-2">{row.detail_code ?? '—'}</span>
              <span className="text-ink-3">
                <EnumLabel group="checkedBy" value={row.checked_by} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

async function Versions({ params }: { params: Record<string, string | string[] | undefined> }) {
  const [t, te, f] = await Promise.all([
    getTranslations('backoffice.health'),
    getTranslations('backoffice.enums'),
    getFormatters(),
  ]);
  const range = parseRange(params.range, ['7d', '30d'] as const, '30d');
  const platform =
    params.platform === 'ios' || params.platform === 'android' ? params.platform : null;
  const oldOnly = params.old === 'true';
  const result = await readAdmin('GET /health/app-versions', { query: { range } });
  const links = (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedLinks
        label={t('versionsRange')}
        active={range}
        items={(['7d', '30d'] as const).map((key) => ({
          key,
          href: withParam('/health', params, { range: key }),
          label: t(`ranges.r${key}`),
        }))}
      />
      <SegmentedLinks
        label={t('platform')}
        active={platform ?? 'all'}
        items={(['all', 'ios', 'android'] as const).map((key) => ({
          key,
          href: withParam('/health', params, { platform: key === 'all' ? null : key }),
          label: key === 'all' ? t('allPlatforms') : te(`platform.${key}`),
        }))}
      />
      <Link
        href={withParam('/health', params, { old: oldOnly ? null : 'true' })}
        aria-current={oldOnly ? 'page' : undefined}
        className="text-bo-body font-semibold text-text-link hover:underline"
      >
        {oldOnly ? t('allVersions') : t('oldOnly')}
      </Link>
    </div>
  );
  if (!result.ok) {
    return (
      <>
        {links}
        <Card>
          <ReadError error={result.error} />
        </Card>
      </>
    );
  }
  const rows = result.data.versions
    .filter((row) => platform === null || row.platform === platform)
    .filter((row) => !oldOnly || row.below_minimum);
  return (
    <div className="flex flex-col gap-4">
      {links}
      <Panel title={t('versions')} description={t('versionsHint')}>
        {rows.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noVersions')}</p>
        ) : (
          <table className="w-full text-bo-table tabular-nums" data-testid="app-versions">
            <caption className="sr-only">{t('versions')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('platform')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('version')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  {t('installs')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  {t('syncErrorRate')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('columns.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.platform}-${row.app_version}`}
                  className="border-t border-border-row"
                >
                  <td className="py-1.5 pr-3 text-ink">{te(`platform.${row.platform}`)}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">{row.app_version}</td>
                  <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.installations)}</td>
                  <td className="py-1.5 pr-3 text-right text-ink">
                    {f.percent(row.sync_error_rate)}
                  </td>
                  <td className="py-1.5">
                    {row.below_minimum ? (
                      <span className="rounded-pill bg-tone-warning-soft px-2 text-bo-meta text-tone-warning-text">
                        {t('oldVersion')}
                      </span>
                    ) : (
                      <span className="text-ink-3">{t('currentVersion')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

async function Cron() {
  const [t, f] = await Promise.all([getTranslations('backoffice.health'), getFormatters()]);
  const result = await readAdmin('GET /health/cron');
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} />
      </Card>
    );
  }
  return (
    <Panel
      title={t('cron')}
      description={t('workerLag', {
        lag: result.data.worker_lag_s === null ? '—' : f.duration(result.data.worker_lag_s * 1000),
      })}
    >
      <table className="w-full text-bo-table tabular-nums" data-testid="cron-schedules">
        <caption className="sr-only">{t('cron')}</caption>
        <thead>
          <tr className="text-left text-bo-meta text-ink-2">
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              {t('columns.job')}
            </th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              {t('columns.lastRun')}
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
              {t('columns.latency')}
            </th>
            <th scope="col" className="py-1.5 font-semibold">
              {t('columns.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.data.schedules.map((row) => (
            <tr key={row.name} className="border-t border-border-row">
              <td className="py-1.5 pr-3 font-mono text-ink">{row.name}</td>
              <td className="py-1.5 pr-3 text-ink">{f.dateTime(row.last_run_at)}</td>
              <td className="py-1.5 pr-3 text-right text-ink">{f.duration(row.duration_ms)}</td>
              <td className="py-1.5 font-mono text-ink">{row.status ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
