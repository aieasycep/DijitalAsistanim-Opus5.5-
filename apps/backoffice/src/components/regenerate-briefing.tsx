'use client';

import { useTranslations } from 'next-intl';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { daysBetween, localDateIn } from '@/lib/formatters';
import { useFormatters } from '@/lib/use-formatters';

/**
 * Whether "Yeniden oluştur" applies (BACKOFFICE_PLAN §6.7): only a failed or skipped briefing of
 * the user's current local day. The user's timezone is not in the row, so the button allows the
 * admin's today ± 1 day; admin-api enforces the exact rule.
 */
export function regenerateBlock(
  status: string,
  localDate: string,
  today: string,
): 'status' | 'date' | null {
  if (status !== 'failed' && status !== 'skipped') return 'status';
  return Math.abs(daysBetween(today, localDate)) > 1 ? 'date' : null;
}

export function RegenerateBriefing({
  briefingId,
  status,
  localDate,
}: {
  briefingId: string;
  status: string;
  localDate: string;
}) {
  const t = useTranslations('backoffice.briefings.regenerate');
  const can = useCan();
  const f = useFormatters();
  if (!can('briefings.regenerate')) return null;
  const block = regenerateBlock(status, localDate, localDateIn(f.timeZone));
  return (
    <ActionButton
      route="POST /briefings/:id/regenerate"
      params={{ id: briefingId }}
      label={t('button')}
      disabled={block !== null}
      disabledReason={block === 'date' ? t('onlyToday') : t('onlyFailed')}
      title={t('title')}
      effects={t('effects')}
      confirmLabel={t('button')}
      successMessage={t('done')}
      testId={`regenerate-${briefingId}`}
    />
  );
}
