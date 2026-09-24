import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { KeyValueList, Panel, ReadError } from '@/components/module-kit';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { getFormatters } from '@/server/formatters';
import { userIdFrom, userOverview } from '../data';

/*
 * User › Genel (BACKOFFICE_PLAN §6.3a, M§49): the privacy-safe support view: account state, plan,
 * integrations with their sync state, recent job errors, the latest briefings, push status and the
 * app version. Identifiers only; no content.
 */
export default async function UserOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = await userIdFrom(params);
  const [t, f, result] = await Promise.all([
    getTranslations('backoffice.userDetail.overview'),
    getFormatters(),
    userOverview(id),
  ]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} backHref="/users" />
      </Card>
    );
  }
  const data = result.data;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title={t('account')}>
        <KeyValueList
          items={[
            {
              label: t('status'),
              value: <StatusBadge group="userState" value={data.account_status} />,
            },
            { label: t('plan'), value: <StatusBadge group="plan" value={data.plan} /> },
            { label: t('platform'), value: <EnumLabel group="platform" value={data.platform} /> },
            { label: t('appVersion'), value: data.app_version ?? '—', mono: true },
          ]}
        />
      </Panel>
      <Panel title={t('push')}>
        <KeyValueList
          items={[
            { label: t('pushTokens'), value: f.number(data.push_status.tokens_enabled) },
            {
              label: t('lastReceiptError'),
              value: data.push_status.last_receipt_error ?? t('noReceiptError'),
              mono: data.push_status.last_receipt_error !== null,
            },
          ]}
        />
      </Panel>
      <Panel title={t('integrations')}>
        {data.integrations.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noIntegrations')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-row">
            {data.integrations.map((integration, index) => (
              <li
                key={`${integration.provider}-${String(index)}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="flex items-center gap-2 text-bo-body text-ink">
                  <EnumLabel group="provider" value={integration.provider} />
                  <StatusBadge group="accountStatus" value={integration.status} />
                </span>
                <span className="text-bo-meta text-ink-3">
                  {t('lastSync', { time: f.dateTime(integration.last_sync_at) })}
                  {integration.last_error_code === null ? null : (
                    <span className="ml-2 font-mono text-tone-critical-text">
                      {integration.last_error_code}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/users/${id}/integrations`}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('openIntegrations')}
        </Link>
      </Panel>
      <Panel title={t('jobErrors')}>
        {data.job_errors.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noJobErrors')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.job_errors.map((code, index) => (
              <li
                key={`${code}-${String(index)}`}
                className="font-mono text-bo-mono text-tone-critical-text"
              >
                {code}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/jobs?f.user_id=${id}&f.status=failed`}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('openJobs')}
        </Link>
      </Panel>
      <Panel title={t('briefings')} className="xl:col-span-2">
        {data.briefing_status.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noBriefings')}</p>
        ) : (
          <table className="w-full text-bo-table tabular-nums">
            <caption className="sr-only">{t('briefings')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('briefingDate')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('briefingKind')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.briefing_status.map((row) => (
                <tr key={`${row.local_date}-${row.kind}`} className="border-t border-border-row">
                  <td className="py-1.5 pr-3 text-ink">{f.localDate(row.local_date)}</td>
                  <td className="py-1.5 pr-3 text-ink">
                    <EnumLabel group="briefingKind" value={row.kind} />
                  </td>
                  <td className="py-1.5">
                    <StatusBadge group="briefingStatus" value={row.status} />
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
