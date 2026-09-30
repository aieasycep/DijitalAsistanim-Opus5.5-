import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { BackofficeEnv } from '@/env';
import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  applyJarWrites,
  chunkWrites,
  openJar,
  presentChunkNames,
  sealJar,
  sealingKey,
  type CookieWrite,
} from './cookie-seal';

/*
 * Supabase Auth for the backoffice (BACKOFFICE_PLAN §2.1, §3.8). Only the publishable key is used, only
 * on the server: email one-time code, TOTP MFA, refresh and sign-out. The session lives in the sealed
 * `__Host-da_admin` jar (see `cookie-seal.ts`), so the browser never sees an access or refresh token.
 * This module has no Next request dependency so `proxy.ts` can use it directly.
 */

export interface CookieIO {
  /** Cookies of the incoming request. */
  read(): readonly { name: string; value: string }[];
  /** Applies cookie writes to the outgoing response (ignored where a response cannot set cookies). */
  write(writes: readonly CookieWrite[]): void;
}

export type SupabaseEnv = Pick<
  BackofficeEnv,
  'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'ADMIN_BFF_SECRET'
>;

/** A per-request server client whose cookie storage is the sealed jar behind `io`. */
export async function createSealedSupabase(
  io: CookieIO,
  env: SupabaseEnv,
): Promise<SupabaseClient> {
  const key = await sealingKey(env.ADMIN_BFF_SECRET);
  const initial = io.read();
  let jar = await openJar(key, initial, AUTH_COOKIE);
  const known = new Set(presentChunkNames(initial, AUTH_COOKIE));
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        name: AUTH_COOKIE,
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: AUTH_COOKIE_MAX_AGE,
      },
      cookies: {
        encode: 'tokens-only',
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
        setAll: async (writes) => {
          jar = applyJarWrites(jar, writes);
          const sealed = await sealJar(key, jar, AUTH_COOKIE);
          const out = chunkWrites(AUTH_COOKIE, sealed, [...known]);
          for (const write of out) {
            if (write.options.maxAge === 0) known.delete(write.name);
            else known.add(write.name);
          }
          io.write(out);
        },
      },
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: true },
    },
  );
}
