'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { CheckboxField } from '@/components/form-fields';
import { confirmToken } from '@/lib/formatters';

const DEVICE_PROVIDERS = new Set(['apple_device', 'android_device']);
const RECONNECT = new Set(['needs_reauth', 'admin_consent_required', 'disconnected']);

/*
 * Per-account actions (BACKOFFICE_PLAN §6.3b, §6.5): "Senkronu başlat" (L2), "Watch'ı yenile" (L2)
 * and "Bağlantıyı kes…" (L3, typed last 6 of the account id, step-up). Actions that are permitted but
 * not valid in the current state are disabled with the reason (§4.5).
 */
export function AccountActions({
  userId,
  accountId,
  status,
  provider,
}: {
  userId: string;
  accountId: string;
  status: string;
  provider: string;
}) {
  const t = useTranslations('backoffice.accountActions');
  const can = useCan();
  const [purge, setPurge] = useState<'purge'[]>([]);
  const device = DEVICE_PROVIDERS.has(provider);
  const needsReconnect = RECONNECT.has(status);
  const syncBlocked = device ? t('deviceOnly') : needsReconnect ? t('reconnectFirst') : null;
  return (
    <div className="flex flex-wrap gap-2">
      {can('users.force_sync') ? (
        <ActionButton
          route="POST /integrations/:accountId/force-sync"
          params={{ accountId }}
          label={t('forceSync')}
          disabled={syncBlocked !== null}
          {...(syncBlocked === null ? {} : { disabledReason: syncBlocked })}
          title={t('forceSyncTitle')}
          effects={t('forceSyncEffects')}
          confirmLabel={t('forceSync')}
          successMessage={(data) => t('queued', { count: data.jobs.length })}
        />
      ) : null}
      {can('integrations.renew_watch') ? (
        <ActionButton
          route="POST /integrations/:accountId/renew-watch"
          params={{ accountId }}
          label={t('renewWatch')}
          disabled={device || status === 'disconnected'}
          disabledReason={device ? t('deviceOnly') : t('disconnectedAlready')}
          title={t('renewWatchTitle')}
          effects={t('renewWatchEffects')}
          confirmLabel={t('renewWatch')}
          successMessage={(data) => t('queued', { count: data.jobs.length })}
        />
      ) : null}
      {can('integrations.disconnect') ? (
        <ActionButton
          route="POST /users/:id/integrations/:accountId/disconnect"
          params={{ id: userId, accountId }}
          body={() => ({ purge_content: purge.length > 0 })}
          label={t('disconnect')}
          variant="destructive"
          tone="destructive"
          disabled={status === 'disconnected'}
          disabledReason={t('disconnectedAlready')}
          typedToken={confirmToken(accountId)}
          title={t('disconnectTitle')}
          effects={t('disconnectEffects')}
          fields={
            <CheckboxField
              legend={t('purgeLegend')}
              options={[{ value: 'purge', label: t('purge') }]}
              values={purge}
              onChange={setPurge}
            />
          }
          confirmLabel={t('disconnect')}
          successMessage={(data) =>
            t('disconnected', { revocation: t(`revocation.${data.revocation}`) })
          }
        />
      ) : null}
    </div>
  );
}
