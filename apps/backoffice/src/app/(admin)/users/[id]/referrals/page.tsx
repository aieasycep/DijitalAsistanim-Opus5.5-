import { getTranslations } from 'next-intl/server';

import { KeyValueList, Panel, ReadError } from '@/components/module-kit';
import { ReferralReview } from '@/components/referral-review';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { userIdFrom } from '../data';

/*
 * User › Davetler (BACKOFFICE_PLAN §6.3f; M§45, M§62; P-06): the user's code, referrals as referrer
 * (masked referees, status, risk score and signal labels, never the hashed signals), the referee
 * side, credits with their grants and the yearly reward cap usage.
 */
export default async function UserReferralsPage({ params }: { params: Promise<{ id: string }> }) {
  const id = await userIdFrom(params);
  const [t, f, result] = await Promise.all([
    getTranslations('backoffice.userDetail.referrals'),
    getFormatters(),
    readAdmin('GET /users/:id/referrals', {
      params: { id },
      query: { page: 1, page_size: 50, order: 'desc' },
    }),
  ]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} backHref="/users" />
      </Card>
    );
  }
  const data = result.data;
  const nothing =
    data.as_referrer.length === 0 && data.as_referee === null && data.credits.length === 0;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title={t('summary')}>
        <KeyValueList
          items={[
            { label: t('code'), value: data.code ?? '—', mono: true },
            {
              label: t('yearly'),
              value: t('yearlyValue', {
                used: data.yearly_rewards.used,
                max: data.yearly_rewards.max,
              }),
            },
            {
              label: t('referee'),
              value:
                data.as_referee === null ? (
                  t('notReferred')
                ) : (
                  <span className="flex items-center gap-2">
                    {data.as_referee.referrer_masked}
                    <StatusBadge group="referralStatus" value={data.as_referee.status} />
                  </span>
                ),
            },
          ]}
        />
      </Panel>
      <Panel title={t('credits')}>
        {data.credits.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noCredits')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.credits.map((credit) => (
              <li
                key={`${credit.referral_id}-${credit.side}`}
                className="flex justify-between text-bo-table"
              >
                <span className="text-ink">
                  <EnumLabel group="referralSide" value={credit.side} />
                </span>
                <span className="tabular-nums text-ink">
                  {t('creditDays', { days: credit.days })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t('asReferrer')} className="xl:col-span-2">
        {nothing || data.as_referrer.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('empty')}</p>
        ) : (
          <table className="w-full text-bo-table tabular-nums">
            <caption className="sr-only">{t('asReferrer')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('refereeColumn')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('status')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  {t('risk')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('signals')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('created')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.as_referrer.map((row) => (
                <tr key={row.id} className="border-t border-border-row">
                  <td className="py-1.5 pr-3 text-ink">{row.referee_masked}</td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge group="referralStatus" value={row.status} />
                  </td>
                  <td className="py-1.5 pr-3 text-right text-ink">{f.percent(row.risk_score)}</td>
                  <td className="py-1.5 pr-3 text-ink">{row.signal_labels.join(', ') || '—'}</td>
                  <td className="py-1.5 pr-3 text-ink">{f.dateTime(row.created_at)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <ReferralReview referralId={row.id} status={row.status} />
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
