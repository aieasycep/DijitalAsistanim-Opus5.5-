'use client';

import { useTranslations } from 'next-intl';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';

/*
 * Data request actions (BACKOFFICE_PLAN §6.19): retry a failed request from its first incomplete
 * step (L2) and regenerate an expired or failed export (L2). Web requests whose email code is not
 * verified yet have no actions.
 */
export function DataRequestActions({
  kind,
  id,
  status,
  origin,
}: {
  kind: 'export' | 'history_deletion' | 'account_deletion';
  id: string;
  status: string;
  origin: string;
}) {
  const t = useTranslations('backoffice.dataRequests.actions');
  const can = useCan();
  if (!can('data_requests.manage')) return null;
  if (origin === 'web_otp' && status === 'requested') return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton
        route="POST /data-requests/:kind/:id/retry"
        params={{ kind, id }}
        label={t('retry')}
        disabled={status !== 'failed'}
        disabledReason={t('retryOnlyFailed')}
        title={t('retryTitle')}
        effects={kind === 'export' ? t('retryExportEffects') : t('retryDeletionEffects')}
        confirmLabel={t('retry')}
        successMessage={t('retried')}
        testId="data-request-retry"
      />
      {kind === 'export' ? (
        <ActionButton
          route="POST /data-requests/export/:id/regenerate"
          params={{ id }}
          label={t('regenerate')}
          disabled={status !== 'expired'}
          disabledReason={t('regenerateOnly')}
          title={t('regenerateTitle')}
          effects={t('regenerateEffects')}
          confirmLabel={t('regenerate')}
          successMessage={t('regenerated')}
          testId="data-request-regenerate"
        />
      ) : null}
    </div>
  );
}
