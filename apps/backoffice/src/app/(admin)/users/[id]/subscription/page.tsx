import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { GrantProButton, RevokeGrantButton } from '@/components/entitlement-actions';
import { KeyValueList, Panel, ReadError, withParam } from '@/components/module-kit';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { hasAnyPermission } from '@/lib/admin-context';
import { getFormatters } from '@/server/formatters';
import { loadAdminContext } from '@/server/session';
import { userIdFrom, userSubscription } from '../data';
import { ResyncButton } from '@/components/resync-button';

/*
 * User › Abonelik (BACKOFFICE_PLAN §6.3e, §6.14; M§60, M§61; ADR-11): three separate panels, the
 * store subscription mirror (RevenueCat), the admin/referral grants and the effective entitlement
 * whose source always names which one grants access, plus the sanitised billing events. Grants,
 * revocations and the resync are their own permissions.
 */

function pageParam(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export default async function UserSubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = await userIdFrom(params);
  const sp = await searchParams;
  const grantsPage = pageParam(sp.grants_page);
  const eventsPage = pageParam(sp.events_page);
  const [t, te, f, context, result] = await Promise.all([
    getTranslations('backoffice.userDetail.subscription'),
    getTranslations('backoffice.enums'),
    getFormatters(),
    loadAdminContext(),
    userSubscription(id, grantsPage, eventsPage),
  ]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} backHref="/users" />
      </Card>
    );
  }
  const { store, grants, effective, billing_events: events } = result.data;
  const pager = (key: 'grants_page' | 'events_page', page: number, count: number) => (
    <div className="flex items-center justify-end gap-3 text-bo-meta text-ink-2">
      {page > 1 ? (
        <Link
          href={withParam(`/users/${id}/subscription`, sp, { [key]: String(page - 1) })}
          className="text-text-link hover:underline"
        >
          {t('previous')}
        </Link>
      ) : null}
      <span>{t('page', { page })}</span>
      {count >= 20 ? (
        <Link
          href={withParam(`/users/${id}/subscription`, sp, { [key]: String(page + 1) })}
          className="text-text-link hover:underline"
        >
          {t('next')}
        </Link>
      ) : null}
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title={t('effective')}
        className="xl:col-span-2"
        testId="effective-entitlement"
        actions={
          <>
            <GrantProButton userId={id} grants={grants} />
            {hasAnyPermission(context.permissions, ['subscriptions.resync']) ? (
              <ResyncButton userId={id} />
            ) : null}
          </>
        }
      >
        <p className="text-h3 text-ink" data-testid="effective-summary">
          {effective.entitlement === 'pro'
            ? t('effectivePro', {
                source:
                  effective.source === null
                    ? '—'
                    : effective.source === 'store'
                      ? t('storeSource')
                      : te.has(`grantSource.${effective.source}` as never)
                        ? te(`grantSource.${effective.source}` as never)
                        : effective.source,
                until: f.dateTime(effective.until),
              })
            : t('effectiveFree')}
        </p>
      </Panel>
      <Panel title={t('store')} description={t('storeHint')}>
        {store === null ? (
          <p className="text-bo-body text-ink-2">{t('noStore')}</p>
        ) : (
          <KeyValueList
            items={[
              { label: t('storeName'), value: store.store ?? '—' },
              { label: t('product'), value: store.product_id ?? '—', mono: true },
              { label: t('periodType'), value: store.period_type ?? '—' },
              { label: t('active'), value: store.is_active ? t('yes') : t('no') },
              { label: t('willRenew'), value: store.will_renew ? t('yes') : t('no') },
              { label: t('expires'), value: f.dateTime(store.expires_at) },
              { label: t('billingIssue'), value: f.dateTime(store.billing_issue_detected_at) },
              {
                label: t('environment'),
                value: <EnumLabel group="environment" value={store.environment} />,
              },
              { label: t('synced'), value: f.dateTime(store.synced_at) },
              { label: t('transaction'), value: store.original_transaction_id ?? '—', mono: true },
              ...(store.price_usd === undefined
                ? []
                : [{ label: t('price'), value: f.usd(store.price_usd) }]),
            ]}
          />
        )}
      </Panel>
      <Panel title={t('grants')}>
        {grants.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noGrants')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-row">
            {grants.map((grant) => (
              <li
                key={grant.id}
                className={
                  grant.state === 'scheduled'
                    ? 'my-1 flex flex-col gap-1 rounded-tile border border-dashed border-border-strong p-2'
                    : 'flex flex-col gap-1 py-2'
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-bo-body text-ink">
                    <EnumLabel group="grantSource" value={grant.source} />
                    <StatusBadge group="grantState" value={grant.state} />
                    <span className="text-bo-meta text-ink-3">
                      {t('grantDays', { days: grant.duration_days })}
                    </span>
                  </span>
                  <RevokeGrantButton userId={id} grant={grant} />
                </div>
                <p className="text-bo-meta text-ink-3">
                  {t('grantSpan', {
                    start: f.dateTime(grant.starts_at),
                    end: f.dateTime(grant.ends_at),
                  })}
                  {grant.granted_by === null
                    ? null
                    : ` · ${t('grantedBy', { admin: grant.granted_by })}`}
                </p>
                {grant.reason === null ? null : (
                  <p className="text-bo-meta text-ink-2">{grant.reason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {pager('grants_page', grantsPage, grants.length)}
      </Panel>
      {events === undefined ? null : (
        <Panel title={t('events')} className="xl:col-span-2">
          {events.length === 0 ? (
            <p className="text-bo-body text-ink-2">{t('noEvents')}</p>
          ) : (
            <table className="w-full text-bo-table tabular-nums">
              <caption className="sr-only">{t('events')}</caption>
              <thead>
                <tr className="text-left text-bo-meta text-ink-2">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    {t('eventType')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    {t('environment')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    {t('received')}
                  </th>
                  <th scope="col" className="py-1.5 font-semibold">
                    {t('processed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.event_id} className="border-t border-border-row">
                    <td className="py-1.5 pr-3 font-mono text-ink">{event.type}</td>
                    <td className="py-1.5 pr-3 text-ink">
                      <EnumLabel group="environment" value={event.environment} />
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{f.dateTime(event.received_at)}</td>
                    <td className="py-1.5 text-ink">{event.processed ? t('yes') : t('no')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pager('events_page', eventsPage, events.length)}
        </Panel>
      )}
    </div>
  );
}
