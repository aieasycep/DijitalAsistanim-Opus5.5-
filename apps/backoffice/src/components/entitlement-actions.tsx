'use client';

import { stackGrantWindow } from '@da/domain/entitlements/effective';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton, ActionDialog } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { RadioField } from '@/components/form-fields';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { confirmToken } from '@/lib/formatters';
import { useFormatters } from '@/lib/use-formatters';

/*
 * Temporary Pro (BACKOFFICE_PLAN §6.14, M§61): `entitlements.grant` may give 1/7/14/30 days with
 * source Yönetici/Telafi/Destek; `entitlements.grant_limited` (support) only 1 or 7 days with source
 * Destek. The dialog shows the stacked start and end (a new grant starts when the user's live grants
 * end) and states that the store subscription is not affected. Revoke is L3.
 */

export interface GrantLike {
  readonly id: string;
  readonly source: 'referral_referrer' | 'referral_referee' | 'admin' | 'support' | 'compensation';
  readonly starts_at: string;
  readonly ends_at: string;
  readonly state: 'active' | 'scheduled' | 'ended' | 'revoked';
  readonly revoked_at: string | null;
}

const ALL_DAYS = ['1', '7', '14', '30'] as const;
const LIMITED_DAYS = ['1', '7'] as const;
const SOURCES = ['admin', 'compensation', 'support'] as const;

export function GrantProButton({
  userId,
  grants,
}: {
  userId: string;
  grants: readonly GrantLike[];
}) {
  const t = useTranslations('backoffice.entitlements');
  const label = useEnumLabel();
  const f = useFormatters();
  const can = useCan();
  const search = useSearchParams();
  const full = can('entitlements.grant');
  const limited = !full && can('entitlements.grant_limited');
  const [open, setOpen] = useState(() => search.get('action') === 'grant' && (full || limited));
  const [days, setDays] = useState<(typeof ALL_DAYS)[number]>('7');
  const [source, setSource] = useState<(typeof SOURCES)[number]>(full ? 'admin' : 'support');
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  if (!full && !limited) return null;
  const span = stackGrantWindow({
    grants: grants.map((g) => ({
      source: g.source,
      starts_at: g.starts_at,
      ends_at: g.ends_at,
      revoked_at: g.revoked_at,
    })),
    now: new Date(openedAt),
    days: Number(days),
  });
  const dayOptions = full ? ALL_DAYS : LIMITED_DAYS;
  const sourceOptions = full ? SOURCES : (['support'] as const);
  return (
    <>
      <Button
        onClick={() => {
          setOpenedAt(Date.now());
          setOpen(true);
        }}
        data-testid="grant-pro"
      >
        {t('grant')}
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        route="POST /users/:id/entitlement-grants"
        params={{ id: userId }}
        body={() => ({ duration_days: Number(days), source })}
        title={t('grantTitle')}
        effects={
          <div className="grid gap-1">
            <p>
              {t('grantWindow', {
                start: f.dateTime(span.starts_at),
                end: f.dateTime(span.ends_at),
              })}
            </p>
            <p>{t('storeUnaffected')}</p>
          </div>
        }
        fields={
          <>
            <RadioField
              legend={t('duration')}
              value={days}
              onChange={setDays}
              options={dayOptions.map((value) => ({
                value,
                label: t('days', { days: Number(value) }),
              }))}
              {...(limited ? { help: t('limitedHelp') } : {})}
            />
            <RadioField
              legend={t('source')}
              value={source}
              onChange={setSource}
              options={sourceOptions.map((value) => ({
                value,
                label: label('grantSource', value),
              }))}
            />
          </>
        }
        confirmLabel={t('grant')}
        successMessage={(data) => t('granted', { end: f.dateTime(data.ends_at) })}
      />
    </>
  );
}

export function RevokeGrantButton({ userId, grant }: { userId: string; grant: GrantLike }) {
  const t = useTranslations('backoffice.entitlements');
  const can = useCan();
  if (!can('entitlements.revoke')) return null;
  const revocable =
    (grant.source === 'admin' || grant.source === 'support' || grant.source === 'compensation') &&
    (grant.state === 'active' || grant.state === 'scheduled');
  return (
    <ActionButton
      route="POST /users/:id/entitlement-grants/:grantId/revoke"
      params={{ id: userId, grantId: grant.id }}
      label={t('revoke')}
      variant="ghost"
      tone="destructive"
      disabled={!revocable}
      disabledReason={t('notRevocable')}
      typedToken={confirmToken(grant.id)}
      title={t('revokeTitle')}
      effects={t('revokeEffects')}
      confirmLabel={t('revoke')}
      successMessage={t('revoked')}
      testId={`revoke-${grant.id}`}
    />
  );
}
