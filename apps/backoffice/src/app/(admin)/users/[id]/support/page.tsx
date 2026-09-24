import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Panel, ReadError } from '@/components/module-kit';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { getFormatters } from '@/server/formatters';
import { userIdFrom, userSupport } from '../data';
import { RevokeAccessButton } from './revoke-access';

/*
 * User › Destek (BACKOFFICE_PLAN §6.3g, §9; M§49, M§62; R-09): the user's tickets and every Support
 * Access grant (admin, scopes, reason, start/end, revoked, content view count). A grant is opened
 * from "İşlemler › Destek erişimi iste…" (reason, 15/30/60 min, scopes, step-up).
 */
export default async function UserSupportPage({ params }: { params: Promise<{ id: string }> }) {
  const id = await userIdFrom(params);
  const [t, f, result] = await Promise.all([
    getTranslations('backoffice.userDetail.support'),
    getFormatters(),
    userSupport(id),
  ]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} backHref="/users" />
      </Card>
    );
  }
  const { tickets, access_grants: grants } = result.data;
  return (
    <div className="grid grid-cols-1 gap-4">
      <Panel title={t('tickets')}>
        {tickets.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noTickets')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-row">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-bo-body">
                  <Link
                    href={`/support/${ticket.id}`}
                    className="font-mono text-text-link hover:underline"
                  >
                    {ticket.reference}
                  </Link>
                  <span className="truncate text-ink">{ticket.subject}</span>
                </span>
                <span className="flex items-center gap-2 text-bo-meta text-ink-3">
                  <EnumLabel group="ticketCategory" value={ticket.category} />
                  <StatusBadge group="ticketStatus" value={ticket.status} />
                  {f.dateTime(ticket.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t('grants')} description={t('grantsHint')}>
        {grants.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noGrants')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-row" data-testid="access-grants">
            {grants.map((grant) => (
              <li key={grant.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-bo-body text-ink">
                    {grant.admin.display_name ?? grant.admin.id.slice(0, 8)}
                    {grant.active ? (
                      <span className="rounded-pill bg-tone-warning-soft px-2 text-badge text-tone-warning-text uppercase">
                        {t('active')}
                      </span>
                    ) : null}
                    <span className="text-bo-meta text-ink-3">
                      {grant.scopes.map((scope) => (
                        <span key={scope} className="mr-1">
                          <EnumLabel group="supportScope" value={scope} />
                        </span>
                      ))}
                    </span>
                  </span>
                  {grant.active ? <RevokeAccessButton grantId={grant.id} /> : null}
                </div>
                <p className="text-bo-meta text-ink-3">
                  {t('span', {
                    start: f.dateTime(grant.starts_at),
                    end: f.dateTime(grant.expires_at),
                  })}
                  {' · '}
                  {t('views', { count: grant.reveal_count })}
                  {grant.revoked_at === null
                    ? null
                    : ` · ${t('revokedAt', { time: f.dateTime(grant.revoked_at) })}`}
                </p>
                <p className="text-bo-meta text-ink-2">{grant.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
