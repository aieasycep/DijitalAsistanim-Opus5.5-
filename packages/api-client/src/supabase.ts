/**
 * Supabase client factory (ADR-04, ADR-06; INTEGRATION_PLAN §8.3). Publishable key only — the
 * secret key never reaches a client. Session persistence is injected (`storage`), so the mobile app
 * passes its LargeSecureStore (AES key in SecureStore, ciphertext in MMKV) and the web app its own
 * cookie storage; nothing here touches AsyncStorage or `localStorage`.
 *
 * The `Database` type is supplied by the caller — normally the generated `Database` from
 * `database.types.ts`. `EmptyDatabase` remains for clients that must never touch PostgREST (it types
 * every `from()` / `rpc()` call as an error), so no untyped table access can slip in.
 */
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';

type AuthOptions = NonNullable<SupabaseClientOptions<'public'>['auth']>;

/** The session storage contract of `@supabase/auth-js` (`getItem` / `setItem` / `removeItem`). */
export type AuthStorage = NonNullable<AuthOptions['storage']>;

/**
 * A schema whose every table, view and function is `never`: `from()` / `rpc()` calls do not
 * type-check, so only Auth and Functions are usable until the generated types are supplied.
 */
export interface EmptyDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export interface DaSupabaseOptions {
  readonly url: string;
  /** `sb_publishable_…` */
  readonly publishableKey: string;
  readonly storage: AuthStorage;
  /** Storage key of the session blob (default `da.auth.session`). */
  readonly storageKey?: string;
  /** Web apps that receive the code in the URL set this; native apps never do. */
  readonly detectSessionInUrl?: boolean;
  readonly autoRefreshToken?: boolean;
  readonly fetch?: typeof fetch;
  /** Extra headers on every Supabase request (e.g. `X-DA-Client`). */
  readonly headers?: Readonly<Record<string, string>>;
}

const SECRET_KEY_PREFIX = 'sb_secret_';

/**
 * `createClient` with the auth settings of M-GL-01: PKCE, persisted session, auto refresh (the app
 * starts/stops it with AppState), no URL session detection on native.
 */
export function createSupabaseClient<Database extends { public: unknown }>(
  options: DaSupabaseOptions,
): SupabaseClient<Database> {
  if (options.publishableKey.startsWith(SECRET_KEY_PREFIX)) {
    throw new Error('[api-client] A secret key was passed where the publishable key belongs.');
  }
  return createClient<Database>(options.url, options.publishableKey, {
    auth: {
      storage: options.storage,
      storageKey: options.storageKey ?? 'da.auth.session',
      autoRefreshToken: options.autoRefreshToken ?? true,
      persistSession: true,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
      flowType: 'pkce',
    },
    global: {
      ...(options.headers === undefined ? {} : { headers: { ...options.headers } }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    },
  });
}
