import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Page title 22/28/600 with an optional description and actions (BACKOFFICE_PLAN §5.1). */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-bo-page-title text-ink">{title}</h1>
        {description === undefined ? null : (
          <p className="text-bo-body text-ink-2">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
