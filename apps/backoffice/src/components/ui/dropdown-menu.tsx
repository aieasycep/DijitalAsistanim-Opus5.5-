'use client';

import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/cn';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-48 overflow-hidden rounded-tile bg-surface p-1 text-ink shadow-modal data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  'relative flex min-h-9 cursor-default items-center gap-2 rounded-[8px] px-2 text-bo-body outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-pressed';

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { tone?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemClass, tone === 'destructive' && 'text-tone-critical-text', className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClass, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Icon name="check" size={16} />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 text-bo-meta text-ink-3', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('my-1 h-px bg-border-hairline', className)}
      {...props}
    />
  );
}
