import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export const fieldClassName =
  'w-full rounded-tile border border-border-control bg-surface px-3 text-bo-body text-ink outline-none transition-colors placeholder:text-ink-3 focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/40 disabled:opacity-40 aria-invalid:border-border-error';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(fieldClassName, 'h-10', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClassName, 'min-h-24 resize-y py-2', className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('text-bo-body font-semibold text-ink', className)}
      {...props}
    />
  );
}

/** Field help and error text; link it with `aria-describedby`. */
export function FieldMessage({
  className,
  tone = 'help',
  ...props
}: ComponentProps<'p'> & { tone?: 'help' | 'error' }) {
  return (
    <p
      data-slot="field-message"
      className={cn(
        'text-bo-meta',
        tone === 'error' ? 'text-tone-critical-text' : 'text-ink-3',
        className,
      )}
      {...props}
    />
  );
}
