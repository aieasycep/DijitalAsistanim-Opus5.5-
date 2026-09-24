'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { logoutAction, logoutAllAction } from '@/actions/session';
import { ConfirmDialog } from '@/components/confirm-dialog';

/*
 * Sign-out confirmations shared by the account menu and the command palette (BACKOFFICE_PLAN §3.7,
 * §6.25 "Çıkış yap (opens a confirmation)"): "Çıkış yap" → `POST /session/logout`, "Tüm oturumlardan
 * çık" (level-2) → `POST /session/logout-all`.
 */

interface SessionActionsApi {
  confirmLogout(): void;
  confirmLogoutAll(): void;
}

const Ctx = createContext<SessionActionsApi | null>(null);

export function useSessionActions(): SessionActionsApi {
  const api = useContext(Ctx);
  if (api === null)
    throw new Error('useSessionActions must be used inside <SessionActionsProvider>');
  return api;
}

export function SessionActionsProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.session');
  const [dialog, setDialog] = useState<'logout' | 'logoutAll' | null>(null);
  const api = useMemo<SessionActionsApi>(
    () => ({
      confirmLogout: () => {
        setDialog('logout');
      },
      confirmLogoutAll: () => {
        setDialog('logoutAll');
      },
    }),
    [],
  );
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <ConfirmDialog
        open={dialog === 'logout'}
        onOpenChange={close}
        title={t('logoutTitle')}
        effects={t('logoutText')}
        confirmLabel={t('signOut')}
        successMessage={null}
        onConfirm={() => logoutAction()}
      />
      <ConfirmDialog
        open={dialog === 'logoutAll'}
        onOpenChange={close}
        title={t('logoutAllTitle')}
        effects={t('logoutAllText')}
        confirmLabel={t('logoutAllTitle')}
        tone="destructive"
        successMessage={null}
        onConfirm={(envelope) => logoutAllAction(envelope)}
      />
    </Ctx.Provider>
  );
}
