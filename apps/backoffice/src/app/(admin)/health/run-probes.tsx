'use client';

import { useTranslations } from 'next-intl';

import { useInlineMutation } from '@/components/action-dialog';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';

/**
 * "Şimdi çalıştır" (BACKOFFICE_PLAN §6.21): L1, no reason; admin-api invokes the `health` function
 * synchronously and audits `health.run_requested`. The page re-renders with the fresh results.
 */
export function RunProbesButton() {
  const t = useTranslations('backoffice.health');
  const { run, pending } = useInlineMutation();
  return (
    <Button
      onClick={() => {
        run('POST /health/run', {}, {}, { successMessage: t('ran') });
      }}
      disabled={pending}
      aria-busy={pending}
      data-testid="health-run"
    >
      <Icon name="refresh" size={16} />
      {pending ? t('running') : t('runNow')}
    </Button>
  );
}
