'use client';

import type { UserDevicesResponse, UserSupportResponse } from '@da/validation/admin/users';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { z } from 'zod';

import { ActionDialog } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { CheckboxField, RadioField, SelectField } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { confirmToken } from '@/lib/formatters';
import { useFormatters } from '@/lib/use-formatters';
import { PushTestPreview } from './push-test-preview';

type Device = z.infer<typeof UserDevicesResponse>['data'][number];
type Ticket = z.infer<typeof UserSupportResponse>['data']['tickets'][number];
type ActionKey = 'force-sync' | 'resync' | 'push-test' | 'support-access' | 'internal' | 'disable';

const RESOURCES = ['mail', 'calendar', 'tasks'] as const;
const SCOPES = [
  'pii',
  'email_metadata',
  'insights',
  'notifications',
  'captures',
  'assistant_transcript',
  'ai_feedback',
] as const;
const DURATIONS = ['15', '30', '60'] as const;
const PALETTE_ACTIONS: readonly ActionKey[] = [
  'force-sync',
  'resync',
  'push-test',
  'support-access',
  'internal',
  'disable',
];

/*
 * "İşlemler" (BACKOFFICE_PLAN §6.3): each item is rendered only when the admin holds its
 * permission (cosmetic; admin-api decides) and opens the matching L2/L3 dialog. A palette command
 * lands here with `?action=<name>` and opens the dialog; nothing runs without confirmation.
 */
export function UserActions({
  userId,
  status,
  devices,
  tickets,
  hasActiveGrant,
}: {
  userId: string;
  status: 'active' | 'disabled' | 'deletion_pending';
  devices: readonly Device[] | null;
  tickets: readonly Ticket[];
  hasActiveGrant: boolean;
}) {
  const t = useTranslations('backoffice.userDetail.actions');
  const label = useEnumLabel();
  const f = useFormatters();
  const can = useCan();
  const router = useRouter();
  const search = useSearchParams();
  const requested = search.get('action');
  const [open, setOpen] = useState<ActionKey | null>(() =>
    PALETTE_ACTIONS.includes(requested as ActionKey) ? (requested as ActionKey) : null,
  );
  const [resources, setResources] = useState<(typeof RESOURCES)[number][]>([...RESOURCES]);
  const [installation, setInstallation] = useState<string>('all');
  const [scopes, setScopes] = useState<(typeof SCOPES)[number][]>(['pii']);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>('15');
  const [ticketId, setTicketId] = useState<string>(tickets[0]?.id ?? 'none');
  const [internal, setInternal] = useState<'mark' | 'unmark'>('mark');

  const canGrant = can('entitlements.grant') || can('entitlements.grant_limited');
  const activeDevices = (devices ?? []).filter((device) => device.push_enabled);
  const disabled = status === 'disabled';
  const token = confirmToken(userId);
  const items: { key: ActionKey | 'grant'; label: string; tone?: 'destructive' }[] = [];
  if (can('users.force_sync')) items.push({ key: 'force-sync', label: t('forceSync.menu') });
  if (canGrant) items.push({ key: 'grant', label: t('grant.menu') });
  if (can('subscriptions.resync')) items.push({ key: 'resync', label: t('resync.menu') });
  if (can('push.test')) items.push({ key: 'push-test', label: t('pushTest.menu') });
  if (can('support.access') && !hasActiveGrant)
    items.push({ key: 'support-access', label: t('supportAccess.menu') });
  if (can('users.mark_internal')) items.push({ key: 'internal', label: t('internal.menu') });
  if (can('users.disable'))
    items.push({
      key: 'disable',
      label: disabled ? t('restore.menu') : t('disable.menu'),
      ...(disabled ? {} : { tone: 'destructive' as const }),
    });
  if (items.length === 0) return null;

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" data-testid="user-actions">
            {t('menu')}
            <Icon name="expand_more" size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item, index) => (
            <div key={item.key}>
              {item.key === 'disable' && index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                {...(item.tone === undefined ? {} : { tone: item.tone })}
                onSelect={() => {
                  if (item.key === 'grant') {
                    router.push(`/users/${userId}/subscription?action=grant`);
                    return;
                  }
                  setOpen(item.key);
                }}
              >
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ActionDialog
        open={open === 'force-sync'}
        onOpenChange={close}
        route="POST /users/:id/force-sync"
        params={{ id: userId }}
        body={() => (resources.length === RESOURCES.length ? {} : { resources: [...resources] })}
        title={t('forceSync.title')}
        effects={t('forceSync.effects')}
        fields={
          <CheckboxField
            legend={t('forceSync.resources')}
            options={RESOURCES.map((value) => ({ value, label: label('resource', value) }))}
            values={resources}
            onChange={setResources}
          />
        }
        validate={() => (resources.length === 0 ? t('forceSync.noResource') : null)}
        confirmLabel={t('forceSync.confirm')}
        successMessage={(data) => t('forceSync.done', { count: data.jobs.length })}
      />

      <ActionDialog
        open={open === 'resync'}
        onOpenChange={close}
        route="POST /subscriptions/:userId/sync"
        params={{ userId }}
        title={t('resync.title')}
        effects={t('resync.effects')}
        confirmLabel={t('resync.confirm')}
        successMessage={t('resync.done')}
      />

      <ActionDialog
        open={open === 'push-test'}
        onOpenChange={close}
        route="POST /notifications/test-push"
        body={() => ({
          user_id: userId,
          ...(installation === 'all' ? {} : { installation_id: installation }),
        })}
        title={t('pushTest.title')}
        effects={t('pushTest.effects')}
        fields={
          devices !== null && activeDevices.length === 0 ? (
            <p role="alert" className="text-bo-body text-tone-warning-text">
              {t('pushTest.noDevice')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {open === 'push-test' ? (
                <PushTestPreview
                  userId={userId}
                  installationId={installation === 'all' ? null : installation}
                />
              ) : null}
              {devices === null ? (
                <p className="text-bo-meta text-ink-2">{t('pushTest.devicesUnknown')}</p>
              ) : (
                <RadioField
                  legend={t('pushTest.device')}
                  inline={false}
                  value={installation}
                  onChange={setInstallation}
                  options={[
                    { value: 'all', label: t('pushTest.allDevices') },
                    ...activeDevices.map((device) => ({
                      value: device.installation_id,
                      label: t('pushTest.deviceLabel', {
                        platform: label('platform', device.platform),
                        version: device.app_version,
                        token: device.token_masked ?? '—',
                      }),
                    })),
                  ]}
                />
              )}
            </div>
          )
        }
        validate={() =>
          devices !== null && activeDevices.length === 0 ? t('pushTest.noDevice') : null
        }
        confirmLabel={t('pushTest.confirm')}
        successMessage={(data) =>
          data.deferred_until === null
            ? t('pushTest.queued')
            : t('pushTest.deferred', { time: f.dateTime(data.deferred_until) })
        }
      />

      <ActionDialog
        open={open === 'support-access'}
        onOpenChange={close}
        route="POST /support-access/grants"
        body={() => ({
          user_id: userId,
          scopes: [...scopes],
          duration_minutes: Number(duration),
          ...(ticketId === 'none' ? {} : { ticket_id: ticketId }),
        })}
        title={t('supportAccess.title')}
        effects={t('supportAccess.effects')}
        typedToken={token}
        fields={
          <>
            <CheckboxField
              legend={t('supportAccess.scopes')}
              options={SCOPES.map((value) => ({ value, label: label('supportScope', value) }))}
              values={scopes}
              onChange={setScopes}
              help={t('supportAccess.never')}
            />
            <RadioField
              legend={t('supportAccess.duration')}
              value={duration}
              onChange={setDuration}
              options={DURATIONS.map((value) => ({
                value,
                label: t('supportAccess.minutes', { minutes: Number(value) }),
              }))}
            />
            <SelectField
              label={t('supportAccess.ticket')}
              value={ticketId}
              onChange={setTicketId}
              options={[
                { value: 'none', label: t('supportAccess.noTicket') },
                ...tickets.map((ticket) => ({
                  value: ticket.id,
                  label: `${ticket.reference} · ${ticket.subject}`,
                })),
              ]}
            />
          </>
        }
        validate={() => (scopes.length === 0 ? t('supportAccess.noScope') : null)}
        confirmLabel={t('supportAccess.confirm')}
        successMessage={t('supportAccess.done')}
      />

      <ActionDialog
        open={open === 'internal'}
        onOpenChange={close}
        route="POST /users/:id/internal"
        params={{ id: userId }}
        body={() => ({ internal: internal === 'mark' })}
        title={t('internal.title')}
        effects={t('internal.effects')}
        fields={
          <RadioField
            legend={t('internal.choice')}
            value={internal}
            onChange={setInternal}
            options={[
              { value: 'mark', label: t('internal.mark') },
              { value: 'unmark', label: t('internal.unmark') },
            ]}
          />
        }
        confirmLabel={t('internal.confirm')}
        successMessage={(data) => (data.internal ? t('internal.marked') : t('internal.unmarked'))}
      />

      <ActionDialog
        open={open === 'disable'}
        onOpenChange={close}
        route={disabled ? 'POST /users/:id/restore' : 'POST /users/:id/disable'}
        params={{ id: userId }}
        title={disabled ? t('restore.title') : t('disable.title')}
        effects={disabled ? t('restore.effects') : t('disable.effects')}
        typedToken={token}
        tone={disabled ? 'default' : 'destructive'}
        confirmLabel={disabled ? t('restore.confirm') : t('disable.confirm')}
        successMessage={disabled ? t('restore.done') : t('disable.done')}
      />
    </>
  );
}
