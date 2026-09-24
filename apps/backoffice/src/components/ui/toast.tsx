'use client';

import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/*
 * Toasts on Radix Toast (an aria-live region with swipe-to-dismiss). sonner is not used: it injects
 * a `<style>` element at runtime, which the nonce CSP forbids (SECURITY_AND_PRIVACY_PLAN CTL-3.18).
 * Success is shown only after the server confirms (BACKOFFICE_PLAN §5.4, no timer-based fakes).
 */

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: 'default' | 'error';
}

interface ToastApi {
  show(message: string, tone?: ToastItem['tone']): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

let nextId = 1;

export function ToastProvider({ children, label }: { children: ReactNode; label: string }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const show = useCallback((message: string, tone: ToastItem['tone'] = 'default') => {
    const id = nextId;
    nextId += 1;
    setItems((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000} label={label}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            type={item.tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((t) => t.id !== item.id));
            }}
            className={cn(
              'flex items-start gap-3 rounded-tile bg-toast-bg px-4 py-3 text-bo-body text-toast-text shadow-toast',
            )}
          >
            <ToastPrimitive.Description>{item.message}</ToastPrimitive.Description>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
