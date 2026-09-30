'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { CheckboxField } from '@/components/form-fields';
import { cancelBlock, retryBlock } from '@/lib/job-policy';

/*
 * Job retry (L2, shows the type guard) and cancel (L2) for failed/dead-letter and queued/retrying
 * jobs (BACKOFFICE_PLAN §6.6). A running job cannot be cancelled ("Çalışan iş iptal edilemez.").
 */
export function JobActions({
  jobId,
  type,
  status,
  size = 'sm',
}: {
  jobId: string;
  type: string;
  status: string;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('backoffice.jobs.actions');
  const can = useCan();
  const [reset, setReset] = useState<'reset'[]>([]);
  const retry = retryBlock({ type, status });
  const cancel = cancelBlock({ status });
  return (
    <>
      {can('jobs.retry') ? (
        <ActionButton
          route="POST /jobs/:id/retry"
          params={{ id: jobId }}
          body={() => ({ reset_attempts: reset.length > 0 })}
          label={t('retry')}
          size={size}
          variant={size === 'md' ? 'primary' : 'ghost'}
          disabled={retry !== null}
          disabledReason={retry === null ? undefined : t(`retryBlocked.${retry}`)}
          title={t('retryTitle')}
          effects={t('retryEffects')}
          fields={
            <CheckboxField
              legend={t('attempts')}
              options={[{ value: 'reset', label: t('resetAttempts') }]}
              values={reset}
              onChange={setReset}
            />
          }
          confirmLabel={t('retry')}
          successMessage={t('retried')}
          testId={`retry-${jobId}`}
        />
      ) : null}
      {can('jobs.cancel') ? (
        <ActionButton
          route="POST /jobs/:id/cancel"
          params={{ id: jobId }}
          label={t('cancel')}
          size={size}
          variant={size === 'md' ? 'secondary' : 'ghost'}
          tone="destructive"
          disabled={cancel !== null}
          disabledReason={cancel === null ? undefined : t(`cancelBlocked.${cancel}`)}
          title={t('cancelTitle')}
          effects={t('cancelEffects')}
          confirmLabel={t('cancel')}
          successMessage={t('cancelled')}
          testId={`cancel-${jobId}`}
        />
      ) : null}
    </>
  );
}
