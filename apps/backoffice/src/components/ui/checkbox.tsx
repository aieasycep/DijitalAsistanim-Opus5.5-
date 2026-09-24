'use client';

import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border-control bg-surface text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 disabled:opacity-40 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Icon name="check" size={16} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
