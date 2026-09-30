'use client';

import { useTranslations } from 'next-intl';

import { ActionButton } from '@/components/action-dialog';

/** "Aboneliği yeniden eşitle" (§6.3e): enqueues `billing_sync` for the user (L2, reason). */
export function ResyncButton({ userId }: { userId: string }) {
  const t = useTranslations('backoffice.userDetail.actions.resync');
  return (
    <ActionButton
      route="POST /subscriptions/:userId/sync"
      params={{ userId }}
      label={t('menu')}
      title={t('title')}
      effects={t('effects')}
      confirmLabel={t('confirm')}
      successMessage={t('done')}
    />
  );
}
