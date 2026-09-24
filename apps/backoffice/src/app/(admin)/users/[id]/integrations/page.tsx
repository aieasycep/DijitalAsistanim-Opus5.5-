import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { KeyValueList, Panel, ReadError } from '@/components/module-kit';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/states/empty-state';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { userIdFrom } from '../data';
import { AccountActions } from '@/components/account-actions';

/*
 * User › Entegrasyonlar (BACKOFFICE_PLAN §6.3b, M§52): per connected account the provider, masked
 * mailbox, granted capabilities, status and error class, per-resource sync state and watch expiry,
 * the (read-only) data-source toggles and the last five sync jobs. No token or ciphertext field
 * exists in this contract.
 */
export default async function UserIntegrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = await userIdFrom(params);
  const [t, f, result] = await Promise.all([
    getTranslations('backoffice.userDetail.integrations'),
    getFormatters(),
    readAdmin('GET /users/:id/integrations', { params: { id } }),
  ]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} backHref="/users" />
      </Card>
    );
  }
  if (result.data.length === 0) {
    return (
      <Card>
        <EmptyState title={t('empty')} />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {result.data.map((account) => (
        <Panel
          key={account.account_id}
          title={account.email_masked ?? '—'}
          description={t('accountId', { id: account.account_id })}
          testId={`account-${account.account_id}`}
          actions={
            <AccountActions
              userId={id}
              accountId={account.account_id}
              status={account.status}
              provider={account.provider}
            />
          }
        >
          <KeyValueList
            columns={3}
            items={[
              {
                label: t('provider'),
                value: <EnumLabel group="provider" value={account.provider} />,
              },
              {
                label: t('status'),
                value: <StatusBadge group="accountStatus" value={account.status} />,
              },
              {
                label: t('errorClass'),
                value: account.error_class ?? '—',
                mono: account.error_class !== null,
              },
              {
                label: t('capabilities'),
                value:
                  account.capabilities_granted.length === 0 ? (
                    '—'
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {account.capabilities_granted.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-pill bg-surface-sunken px-2 text-bo-meta"
                        >
                          <EnumLabel group="capability" value={capability} />
                        </span>
                      ))}
                    </span>
                  ),
              },
            ]}
          />
          <table className="w-full text-bo-table tabular-nums">
            <caption className="pb-1 text-left text-bo-kicker text-ink-3 uppercase">
              {t('resources')}
            </caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('resource')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('lastSuccess')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('lastError')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  {t('failures')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('watch')}
                </th>
              </tr>
            </thead>
            <tbody>
              {account.resources.map((resource) => (
                <tr key={resource.resource} className="border-t border-border-row">
                  <td className="py-1.5 pr-3 text-ink">
                    <EnumLabel group="resource" value={resource.resource} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{f.dateTime(resource.last_success_at)}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {resource.last_error_code ?? '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-ink">
                    {f.number(resource.consecutive_failures)}
                  </td>
                  <td className="py-1.5 text-ink">
                    {resource.watch_status ?? '—'}
                    {resource.watch_expires_at === null
                      ? null
                      : ` · ${t('watchUntil', { time: f.dateTime(resource.watch_expires_at) })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-1">
            <p className="text-bo-kicker text-ink-3 uppercase">{t('dataSources')}</p>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(account.data_sources).map(([key, on]) => (
                <li
                  key={key}
                  className="rounded-pill bg-surface-sunken px-2 py-0.5 text-bo-meta text-ink-2"
                >
                  <EnumLabel group="dataSource" value={key} />
                  {': '}
                  {on ? t('on') : t('off')}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-bo-kicker text-ink-3 uppercase">{t('recentJobs')}</p>
            {account.recent_jobs.length === 0 ? (
              <p className="text-bo-meta text-ink-2">{t('noJobs')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {account.recent_jobs.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 text-bo-table">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="inline-flex min-h-6 items-center font-mono text-text-link hover:underline"
                    >
                      {job.id.slice(0, 8)}
                    </Link>
                    <EnumLabel group="jobType" value={job.type} />
                    <StatusBadge group="jobStatus" value={job.status} />
                    <span className="text-ink-3">{f.dateTime(job.created_at)}</span>
                    {job.last_error_code === null ? null : (
                      <span className="font-mono text-tone-critical-text">
                        {job.last_error_code}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/jobs?f.account_id=${account.account_id}`}
              className="text-bo-body font-semibold text-text-link hover:underline"
            >
              {t('viewJobs')}
            </Link>
          </div>
        </Panel>
      ))}
    </div>
  );
}
