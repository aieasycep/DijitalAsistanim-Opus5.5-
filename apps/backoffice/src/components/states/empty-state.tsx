import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/icon';
import { cn } from '@/lib/cn';

/**
 * Empty state: module copy and an optional primary action (BACKOFFICE_PLAN §5.3 "Empty"). An empty
 * list is a success message, not an error.
 */
export function EmptyState({
  title,
  description,
  icon = 'info',
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-slot="empty-state"
      className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}
    >
      <Icon name={icon} size={28} className="text-ink-3" />
      <p className="text-bo-body font-semibold text-ink">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-md text-bo-meta text-ink-2">{description}</p>
      )}
      {action}
    </div>
  );
}
