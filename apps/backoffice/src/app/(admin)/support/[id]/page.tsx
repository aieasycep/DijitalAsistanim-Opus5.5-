import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Icon } from '@/components/icon';
import { KeyValueList, Panel, ReadError } from '@/components/module-kit';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { UUID_PATTERN } from '@/lib/ids';
import { cn } from '@/lib/cn';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { UserPiiValue } from '../../users/[id]/user-pii-value';
import { TicketComposer, TicketControls } from './ticket-controls';

/*
 * Ticket detail (BACKOFFICE_PLAN §6.4; M§62; T-10.07): the ticket, its content-free diagnostics
 * and the conversation (internal notes, replies sent through the email adapter and inbound replies).
 * Status, category and assignment are L1; an internal note is L1; a reply is L2 (preview + send);
 * closing is L2.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.support');
  return { title: t('detailTitle') };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [t, f, context, result] = await Promise.all([
    getTranslations('backoffice.support'),
    getFormatters(),
    loadAdminContext(),
    readAdmin('GET /support/tickets/:id', { params: { id } }),
  ]);
  const back = (
    <Link
      href="/support"
      className="flex items-center gap-1 text-bo-body font-semibold text-text-link hover:underline"
    >
      <Icon name="arrow_back" size={16} />
      {t('back')}
    </Link>
  );
  if (!result.ok) {
    return (
      <>
        {back}
        <h1 className="text-bo-page-title text-ink">{t('detailTitle')}</h1>
        <Card>
          <ReadError error={result.error} backHref="/support" />
        </Card>
      </>
    );
  }
  const ticket = result.data;
  const canWrite = context.permissions.includes('support.write');
  return (
    <>
      {back}
      <header className="flex flex-col gap-2">
        <p className="font-mono text-bo-mono text-ink-3">{ticket.reference}</p>
        <h1 className="text-bo-page-title text-ink">{ticket.subject}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge group="ticketStatus" value={ticket.status} />
          <span className="text-bo-meta text-ink-2">
            <EnumLabel group="ticketCategory" value={ticket.category} />
          </span>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title={t('message')}>
            <p className="text-bo-body whitespace-pre-wrap text-ink">{ticket.message}</p>
          </Panel>
          <Panel title={t('conversation')}>
            {ticket.notes.length === 0 ? (
              <p className="text-bo-body text-ink-2">{t('noNotes')}</p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="ticket-notes">
                {ticket.notes.map((note) => (
                  <li
                    key={note.id}
                    className={cn(
                      'flex flex-col gap-1 rounded-tile p-3',
                      note.kind === 'internal' ? 'bg-tone-warning-soft' : 'bg-surface-sunken',
                    )}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-bo-meta text-ink-3">
                      <span className="font-semibold text-ink">
                        <EnumLabel group="noteKind" value={note.kind} />
                      </span>
                      <span>{note.author ?? t('system')}</span>
                      <span>{f.dateTime(note.created_at)}</span>
                    </p>
                    <p className="text-bo-body whitespace-pre-wrap text-ink">{note.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {canWrite ? <TicketComposer ticketId={ticket.id} /> : null}
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title={t('properties')}>
            {canWrite ? (
              <TicketControls
                ticketId={ticket.id}
                status={ticket.status}
                category={ticket.category}
                assignee={ticket.assignee}
              />
            ) : (
              <KeyValueList
                columns={1}
                items={[
                  {
                    label: t('columns.status'),
                    value: <StatusBadge group="ticketStatus" value={ticket.status} />,
                  },
                  {
                    label: t('columns.category'),
                    value: <EnumLabel group="ticketCategory" value={ticket.category} />,
                  },
                  { label: t('columns.assignee'), value: ticket.assignee ?? t('unassigned') },
                ]}
              />
            )}
          </Panel>
          <Panel title={t('contact')}>
            <KeyValueList
              columns={1}
              items={[
                {
                  label: t('columns.user'),
                  value:
                    ticket.user_id === null ? (
                      t('webNoMatch')
                    ) : (
                      <Link
                        href={`/users/${ticket.user_id}/overview`}
                        className="font-mono text-text-link hover:underline"
                      >
                        {ticket.user_id.slice(0, 8)}
                      </Link>
                    ),
                },
                {
                  label: t('columns.contact'),
                  value:
                    ticket.contact_email_masked === null ? (
                      t('webNoMatch')
                    ) : ticket.user_id === null ? (
                      ticket.contact_email_masked
                    ) : (
                      <UserPiiValue
                        userId={ticket.user_id}
                        field={`ticket_contact_email:${ticket.id}`}
                        masked={ticket.contact_email_masked}
                        label={t('columns.contact')}
                      />
                    ),
                },
                {
                  label: t('columns.platform'),
                  value:
                    ticket.platform === null ? (
                      '—'
                    ) : (
                      <>
                        <EnumLabel group="platform" value={ticket.platform} />
                        {ticket.app_version === null ? null : ` · ${ticket.app_version}`}
                      </>
                    ),
                },
                { label: t('columns.created'), value: f.dateTime(ticket.created_at) },
              ]}
            />
          </Panel>
          <Panel title={t('diagnostics')} description={t('diagnosticsHint')}>
            {ticket.diagnostics === null || Object.keys(ticket.diagnostics).length === 0 ? (
              <p className="text-bo-body text-ink-2">{t('noDiagnostics')}</p>
            ) : (
              <KeyValueList
                columns={1}
                items={Object.entries(ticket.diagnostics).map(([key, value]) => ({
                  label: key,
                  value:
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                      ? String(value)
                      : JSON.stringify(value),
                  mono: true,
                }))}
              />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
