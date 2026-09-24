/**
 * Session provider (M-GL-01 provider 7): restores the Supabase session from LargeSecureStore,
 * follows `onAuthStateChange`, and runs token auto-refresh only in the foreground. Signing out
 * anywhere (logout, `AUTH_REQUIRED`, another device's global sign-out) flips the status, and the
 * root guards route to sign-in; the query cache is cleared so no other user's data can render.
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { hasSignedInBefore } from '../lib/auth/memory';
import { bindAutoRefresh, getSupabase, type AppSupabaseClient } from '../lib/auth/supabase';
import { getQueryClient } from '../lib/query/client';
import type { AuthStatus } from '../lib/router-guards';

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly userId: string | null;
  readonly hasSignedInBefore: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function fromSession(session: Session | null): AuthContextValue {
  return {
    status: session === null ? 'signed_out' : 'signed_in',
    session,
    userId: session?.user.id ?? null,
    hasSignedInBefore: hasSignedInBefore(),
  };
}

export interface AuthProviderProps {
  readonly children: ReactNode;
  /** Test seam; the app uses the singleton client. */
  readonly client?: AppSupabaseClient;
}

export function AuthProvider({ children, client }: AuthProviderProps) {
  const [value, setValue] = useState<AuthContextValue>({
    status: 'loading',
    session: null,
    userId: null,
    hasSignedInBefore: hasSignedInBefore(),
  });

  useEffect(() => {
    const supabase = client ?? getSupabase();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setValue(fromSession(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') getQueryClient().clear();
      setValue((previous) => {
        const next = fromSession(session);
        return previous.status === next.status && previous.userId === next.userId
          ? { ...previous, session }
          : next;
      });
    });
    const unbind = bindAutoRefresh(supabase);
    return () => {
      active = false;
      data.subscription.unsubscribe();
      unbind();
    };
  }, [client]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (value === null) throw new Error('useAuth() must be used inside <AuthProvider>.');
  return value;
}
