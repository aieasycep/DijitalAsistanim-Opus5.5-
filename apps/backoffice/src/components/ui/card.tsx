import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

/** Card / panel: 16 px radius, 20 px padding, card shadow in light and a hairline ring in dark. */
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-card-sm bg-surface p-5 shadow-card', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-h3 text-ink', className)} {...props} />;
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & {
  tone?: 'neutral' | 'critical' | 'warning' | 'success' | 'info' | 'primary';
}) {
  const tones = {
    neutral: 'bg-tone-neutral-soft text-tone-neutral-text',
    critical: 'bg-tone-critical-soft text-tone-critical-text-strong',
    warning: 'bg-tone-warning-soft text-tone-warning-text',
    success: 'bg-tone-success-soft text-tone-success-text',
    info: 'bg-tone-info-soft text-tone-info-text',
    primary: 'bg-tone-primary-soft text-tone-primary-text',
  } as const;
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 text-badge uppercase',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-tile bg-skeleton-base motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
