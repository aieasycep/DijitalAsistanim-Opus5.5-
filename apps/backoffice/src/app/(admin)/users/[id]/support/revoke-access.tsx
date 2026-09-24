'use client';

import { useTranslations } from 'next-intl';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';

/** "Erişimi sonlandır" (§9): ends a Support Access grant now (reason, audited). */
export function RevokeAccessButton({ grantId }: { grantId: string }) {
  const t = useTranslations('backoffice.supportAccess');
  const can = useCan();
  if (!can('support.access')) return null;
  return (
    <ActionButton
      route="POST /support-access/grants/:id/revoke"
      params={{ id: grantId }}
      label={t('revoke')}
      variant="ghost"
      title={t('revokeTitle')}
      effects={t('revokeEffects')}
      confirmLabel={t('revoke')}
      successMessage={t('revoked')}
    />
  );
}
