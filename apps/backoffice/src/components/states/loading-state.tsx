import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Loading skeletons (no text, BACKOFFICE_PLAN §5.6); the shimmer becomes static with reduced motion.
 * The accessible name comes from a visually hidden "Yükleniyor".
 */
export function LoadingState({ rows = 10, className }: { rows?: number; className?: string }) {
  const t = useTranslations('backoffice.states');
  return (
    <div
      role="status"
      aria-busy="true"
      data-slot="loading-state"
      className={cn('flex flex-col gap-2', className)}
    >
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="rounded-card-sm bg-surface p-5 shadow-card" aria-hidden="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}
