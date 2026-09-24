import { useTranslations } from 'next-intl';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';

/**
 * Forbidden state (BACKOFFICE_PLAN §4.5): "Bu bölümü görüntüleme yetkin yok.", or for the analyst
 * role on a row-level table, the aggregates-only copy (§4.2 notes).
 */
export function ForbiddenState({
  aggregatesOnly = false,
  className,
}: {
  aggregatesOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('backoffice.states');
  return (
    <div
      role="status"
      data-slot="forbidden-state"
      className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}
    >
      <Icon name="lock" size={28} className="text-ink-3" />
      <p className="max-w-md text-bo-body font-semibold text-ink">
        {aggregatesOnly ? t('aggregatesOnly') : t('forbidden')}
      </p>
    </div>
  );
}
