'use client';

import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

import type { AdminContext } from '@/lib/admin-context';

const AdminCtx = createContext<AdminContext | null>(null);

/** Provides the signed-in admin (from `GET /me`, no tokens) to client components. */
export function AdminProvider({ value, children }: { value: AdminContext; children: ReactNode }) {
  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

export function useAdmin(): AdminContext | null {
  return useContext(AdminCtx);
}

/** Cosmetic permission check (BACKOFFICE_PLAN §4.3 layer 1); admin-api re-checks every call. */
export function useCan(): (permission: string) => boolean {
  const ctx = useContext(AdminCtx);
  return useCallback(
    (permission: string) => ctx?.permissions.some((held) => held === permission) ?? false,
    [ctx],
  );
}

/**
 * Renders a `backoffice.*` message chosen at runtime (action failures carry their key). Unknown keys
 * fall back to the generic internal-error copy; an empty `service` gets the neutral service word.
 */
export function useMessage(): (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string {
  const t = useTranslations('backoffice');
  return useCallback(
    (key: string, values: Readonly<Record<string, string | number>> = {}) => {
      const resolved: Record<string, string | number | undefined> = { ...values };
      if (resolved.service === '') resolved.service = t('errors.serviceFallback');
      resolved.correlationId ??= '—';
      type Key = Parameters<typeof t>[0];
      if (!t.has(key as Key))
        return t('errors.internal', { correlationId: String(resolved.correlationId) });
      return t(key as Key, resolved as never);
    },
    [t],
  );
}
