'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton, useInlineMutation } from '@/components/action-dialog';
import { useAdmin } from '@/components/admin-provider';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';

const STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'] as const;
const CATEGORIES = [
  'account',
  'integration',
  'sync',
  'billing',
  'ai_quality',
  'notification',
  'privacy',
  'other',
] as const;
type Status = (typeof STATUSES)[number];
type Category = (typeof CATEGORIES)[number];

/** Status, category and assignment (L1, §6.4); "Kapat" is L2. */
export function TicketControls({
  ticketId,
  status,
  category,
  assignee,
}: {
  ticketId: string;
  status: Status;
  category: Category;
  assignee: string | null;
}) {
  const t = useTranslations('backoffice.support');
  const label = useEnumLabel();
  const admin = useAdmin();
  const { run, pending } = useInlineMutation();
  const params = { id: ticketId };
  return (
    <div className="grid gap-3" aria-busy={pending}>
      <SelectField
        label={t('columns.status')}
        value={status}
        onChange={(next) => {
          if (next === 'closed') return;
          run('PATCH /support/tickets/:id', params, { status: next });
        }}
        options={STATUSES.map((value) => ({
          value,
          label: label('ticketStatus', value),
          disabled: value === 'closed',
        }))}
        help={t('closeHint')}
      />
      <SelectField
        label={t('columns.category')}
        value={category}
        onChange={(next) => {
          run('PATCH /support/tickets/:id', params, { category: next });
        }}
        options={CATEGORIES.map((value) => ({ value, label: label('ticketCategory', value) }))}
      />
      <div className="grid gap-1.5">
        <p className="text-bo-body font-semibold text-ink">{t('columns.assignee')}</p>
        <p className="text-bo-body text-ink-2" data-testid="ticket-assignee">
          {assignee ?? t('unassigned')}
        </p>
        <div className="flex flex-wrap gap-2">
          {admin === null ? null : (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                run('PATCH /support/tickets/:id', params, { assignee_admin_id: admin.admin.id });
              }}
            >
              {t('assignToMe')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || assignee === null}
            onClick={() => {
              run('PATCH /support/tickets/:id', params, { assignee_admin_id: null });
            }}
          >
            {t('unassign')}
          </Button>
        </div>
      </div>
      <ActionButton
        route="PATCH /support/tickets/:id"
        params={params}
        body={{ status: 'closed' }}
        label={t('close')}
        disabled={status === 'closed'}
        disabledReason={t('alreadyClosed')}
        title={t('closeTitle')}
        effects={t('closeEffects')}
        confirmLabel={t('close')}
        successMessage={t('closed')}
      />
    </div>
  );
}

/** Internal note (L1) and reply to the user by email (L2: preview + [Gönder]). */
export function TicketComposer({ ticketId }: { ticketId: string }) {
  const t = useTranslations('backoffice.support');
  const { run, pending } = useInlineMutation();
  const [body, setBody] = useState('');
  const trimmed = body.trim();
  return (
    <div className="grid gap-2 border-t border-border-hairline pt-4">
      <TextAreaField
        label={t('compose')}
        value={body}
        onChange={setBody}
        maxLength={5000}
        help={t('composeHint')}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending || trimmed === ''}
          onClick={() => {
            run(
              'POST /support/tickets/:id/notes',
              { id: ticketId },
              { body: trimmed },
              {
                successMessage: t('noteAdded'),
                onSuccess: () => {
                  setBody('');
                },
              },
            );
          }}
        >
          {t('addNote')}
        </Button>
        <ActionButton
          route="POST /support/tickets/:id/reply"
          params={{ id: ticketId }}
          body={() => ({ body: trimmed })}
          label={t('reply')}
          variant="primary"
          size="md"
          disabled={trimmed === ''}
          disabledReason={t('writeFirst')}
          title={t('replyTitle')}
          effects={
            <div className="grid gap-2">
              <p>{t('replyEffects')}</p>
              <blockquote className="rounded-tile border-l-2 border-border-strong bg-surface p-2 whitespace-pre-wrap">
                {trimmed}
              </blockquote>
            </div>
          }
          confirmLabel={t('send')}
          successMessage={t('replyQueued')}
          onSuccess={() => {
            setBody('');
          }}
        />
      </div>
    </div>
  );
}
