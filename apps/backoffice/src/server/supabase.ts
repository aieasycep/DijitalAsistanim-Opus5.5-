import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { experimental_taintUniqueValue } from 'react';

import { serverEnv } from '@/env';
import { createSealedSupabase, type CookieIO } from './supabase-core';

export { createSealedSupabase, type CookieIO } from './supabase-core';

/** Cookie IO over `next/headers` for server components and server actions. */
export async function nextCookieIO(): Promise<CookieIO> {
  const store = await cookies();
  return {
    read: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    write: (writes) => {
      for (const write of writes) {
        try {
          store.set(write.name, write.value, write.options);
        } catch {
          // Server Components cannot set cookies; proxy.ts has already refreshed the session.
        }
      }
    },
  };
}

/** Supabase server client for the current request (server components and server actions). */
export async function serverSupabase(): Promise<SupabaseClient> {
  return createSealedSupabase(await nextCookieIO(), serverEnv());
}

/**
 * The admin's access token for admin-api calls, or `null` without a session. The token is tainted so
 * React refuses to serialise it into a Client Component by accident (BACKOFFICE_PLAN §2.1).
 */
export async function adminAccessToken(client?: SupabaseClient): Promise<string | null> {
  const supabase = client ?? (await serverSupabase());
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (session === null) return null;
  const taint = experimental_taintUniqueValue as typeof experimental_taintUniqueValue | undefined;
  if (typeof taint === 'function') {
    taint(
      'The admin access token must never be passed to the client.',
      session,
      session.access_token,
    );
  }
  return session.access_token;
}
