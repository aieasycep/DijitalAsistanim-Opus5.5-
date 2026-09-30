'use client';

import { ADMIN_ROLE_VALUES } from '@da/domain/enums';
import { checkAdminChange } from '@da/domain/rbac';
import type { AdminUserRow } from '@da/validation/admin/system';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { z } from 'zod';

import { ActionButton, ActionDialog } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTablePrefs } from '@/components/data-table/use-table-prefs';
import { SelectField, TextField } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { StatusBadge, useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { confirmToken } from '@/lib/formatters';
import { useFormatters } from '@/lib/use-formatters';

type Row = z.infer<typeof AdminUserRow>;
type Role = (typeof ADMIN_ROLE_VALUES)[number];
type ActionKey = 'role' | 'disable' | 'enable' | 'reset-mfa' | 'revoke' | 'resend' | 'unlock';

export function AdminsTable({
  rows,
  total,
  all,
  selfId,
}: {
  rows: readonly Row[];
  total: number;
  all: readonly Row[];
  selfId: string;
}) {
  const t = useTranslations('backoffice.admins');
  const tr = useTranslations('backoffice.roles');
  const label = useEnumLabel();
  const f = useFormatters();
  const can = useCan();
  const table = useTablePrefs('admins');
  const columns: DataTableColumn<Row>[] = [
    { id: 'email', header: t('columns.email'), required: true, cell: (row) => row.email },
    { id: 'role', header: t('columns.role'), cell: (row) => tr(row.role) },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge group="adminStatus" value={row.status} />,
    },
    {
      id: 'last_login_at',
      header: t('columns.lastLogin'),
      sortable: true,
      cell: (row) => f.dateTime(row.last_login_at),
    },
    {
      id: 'mfa',
      header: t('columns.mfa'),
      cell: (row) =>
        row.mfa_enrolled ? (
          t('mfaEnrolled')
        ) : (
          <span className="text-tone-warning-text">{t('mfaMissing')}</span>
        ),
    },
  ];
  return (
    <DataTable<Row>
      tableId="admins"
      caption={t('caption')}
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(row) => row.id}
      emptyTitle={t('empty')}
      {...(can('admins.manage')
        ? {
            rowActions: (row: Row) => <AdminRowActions row={row} all={all} selfId={selfId} />,
            actionsLabel: t('columns.actions'),
          }
        : {})}
      filters={[
        {
          key: 'role',
          label: t('columns.role'),
          single: true,
          options: ADMIN_ROLE_VALUES.map((value) => ({ value, label: tr(value) })),
        },
        {
          key: 'status',
          label: t('columns.status'),
          single: true,
          options: (['invited', 'active', 'disabled'] as const).map((value) => ({
            value,
            label: label('adminStatus', value),
          })),
        },
        {
          key: 'mfa',
          label: t('columns.mfa'),
          single: true,
          options: [
            { value: 'enrolled', label: t('mfaEnrolled') },
            { value: 'missing', label: t('mfaMissing') },
          ],
        },
      ]}
      prefs={table.prefs}
      onPrefsChange={table.onPrefsChange}
      density={table.density}
    />
  );
}

/*
 * Per-admin actions (§6.23): role change, disable and MFA reset are L3 (typed token, step-up);
 * enable, revoke sessions, resend invite and unlock are L2 with step-up. Self-changes and changes
 * that would leave no active super_admin are disabled with the reason (§4.4).
 */
function AdminRowActions({ row, all, selfId }: { row: Row; all: readonly Row[]; selfId: string }) {
  const t = useTranslations('backoffice.admins.actions');
  const tr = useTranslations('backoffice.roles');
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [role, setRole] = useState<Role>(row.role);
  const guard = (change: Parameters<typeof checkAdminChange>[0]['change']) =>
    checkAdminChange({ admins: all, targetId: row.id, callerId: selfId, change });
  const reasonOf = (violation: ReturnType<typeof checkAdminChange>) =>
    violation === 'self_change_forbidden'
      ? t('self')
      : violation === 'last_super_admin'
        ? t('lastSuperAdmin')
        : null;
  const items: { key: ActionKey; label: string; blocked: string | null; tone?: 'destructive' }[] = [
    {
      key: 'role',
      label: t('role'),
      blocked: reasonOf(
        guard({ kind: 'update', role: row.role === 'super_admin' ? 'operations' : 'super_admin' }),
      ),
    },
    row.status === 'disabled'
      ? {
          key: 'enable',
          label: t('enable'),
          blocked: reasonOf(guard({ kind: 'update', status: 'active' })),
        }
      : {
          key: 'disable',
          label: t('disable'),
          blocked: reasonOf(guard({ kind: 'update', status: 'disabled' })),
          tone: 'destructive',
        },
    { key: 'reset-mfa', label: t('resetMfa'), blocked: reasonOf(guard({ kind: 'mfa_reset' })) },
    { key: 'revoke', label: t('revokeSessions'), blocked: row.id === selfId ? t('self') : null },
    ...(row.status === 'invited'
      ? [{ key: 'resend' as const, label: t('resendInvite'), blocked: null }]
      : []),
    { key: 'unlock', label: t('unlock'), blocked: null },
  ];
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const params = { id: row.id };
  const roleGuard = reasonOf(guard({ kind: 'update', role }));
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={t('menu', { email: row.email })}
            data-testid={`admin-actions-${row.id}`}
          >
            <Icon name="more_vert" size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              disabled={item.blocked !== null}
              {...(item.tone === undefined ? {} : { tone: item.tone })}
              onSelect={() => {
                setRole(row.role);
                setOpen(item.key);
              }}
            >
              <span className="flex flex-col">
                <span>{item.label}</span>
                {item.blocked === null ? null : (
                  <span className="text-bo-meta text-ink-3">{item.blocked}</span>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionDialog
        open={open === 'role'}
        onOpenChange={close}
        route="PATCH /admins/:id"
        params={params}
        body={() => ({ role })}
        title={t('roleTitle', { email: row.email })}
        effects={t('roleEffects', { from: tr(row.role), to: tr(role) })}
        fields={
          <SelectField
            label={t('newRole')}
            value={role}
            onChange={setRole}
            options={ADMIN_ROLE_VALUES.map((value) => ({ value, label: tr(value) }))}
          />
        }
        validate={() => (role === row.role ? t('sameRole') : roleGuard)}
        typedToken={confirmToken(row.id)}
        confirmLabel={t('role')}
        successMessage={t('roleChanged')}
      />
      <ActionDialog
        open={open === 'disable'}
        onOpenChange={close}
        route="POST /admins/:id/disable"
        params={params}
        title={t('disableTitle', { email: row.email })}
        effects={t('disableEffects')}
        typedToken={t('disableToken')}
        tone="destructive"
        confirmLabel={t('disable')}
        successMessage={t('disabled')}
      />
      <ActionDialog
        open={open === 'enable'}
        onOpenChange={close}
        route="POST /admins/:id/enable"
        params={params}
        title={t('enableTitle', { email: row.email })}
        effects={t('enableEffects')}
        confirmLabel={t('enable')}
        successMessage={t('enabled')}
      />
      <ActionDialog
        open={open === 'reset-mfa'}
        onOpenChange={close}
        route="POST /admins/:id/reset-mfa"
        params={params}
        title={t('resetMfaTitle', { email: row.email })}
        effects={t('resetMfaEffects')}
        typedToken={confirmToken(row.id)}
        tone="destructive"
        confirmLabel={t('resetMfa')}
        successMessage={t('mfaReset')}
      />
      <ActionDialog
        open={open === 'revoke'}
        onOpenChange={close}
        route="POST /admins/:id/revoke-sessions"
        params={params}
        title={t('revokeTitle', { email: row.email })}
        effects={t('revokeEffects')}
        confirmLabel={t('revokeSessions')}
        successMessage={(data) => t('sessionsRevoked', { count: data.ended_sessions })}
      />
      <ActionDialog
        open={open === 'resend'}
        onOpenChange={close}
        route="POST /admins/:id/resend-invite"
        params={params}
        title={t('resendTitle', { email: row.email })}
        effects={t('resendEffects')}
        confirmLabel={t('resendInvite')}
        successMessage={t('inviteResent')}
      />
      <ActionDialog
        open={open === 'unlock'}
        onOpenChange={close}
        route="POST /admins/:id/unlock"
        params={params}
        title={t('unlockTitle', { email: row.email })}
        effects={t('unlockEffects')}
        confirmLabel={t('unlock')}
        successMessage={t('unlocked')}
      />
    </>
  );
}

/** "Yönetici davet et" (§3.5, L2 + step-up): a dedicated admin identity, never an app user (R-08). */
export function InviteAdminButton() {
  const t = useTranslations('backoffice.admins.invite');
  const tr = useTranslations('backoffice.roles');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('readonly');
  return (
    <ActionButton
      route="POST /admins/invite"
      label={t('button')}
      variant="primary"
      size="md"
      body={() => ({ email: email.trim().toLowerCase(), full_name: name.trim(), role })}
      title={t('title')}
      effects={t('effects')}
      fields={
        <>
          <TextField label={t('email')} type="email" value={email} onChange={setEmail} />
          <TextField label={t('name')} value={name} onChange={setName} maxLength={120} />
          <SelectField
            label={t('role')}
            value={role}
            onChange={setRole}
            options={ADMIN_ROLE_VALUES.map((value) => ({ value, label: tr(value) }))}
          />
        </>
      }
      validate={() => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return t('emailInvalid');
        if (name.trim().length < 2) return t('nameInvalid');
        return null;
      }}
      confirmLabel={t('send')}
      successMessage={t('sent')}
      testId="admin-invite"
    />
  );
}
