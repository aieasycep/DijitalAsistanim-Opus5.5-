/**
 * Supabase clients (IMPLEMENTATION_PLAN T-3.03, SECURITY_AND_PRIVACY_PLAN CTL-3.6).
 *
 * - `userClient(jwt)`: publishable key + the caller's access token → every query runs under RLS.
 * - `serviceClient()`: the secret key → bypasses RLS. Only allow-listed modules may import it
 *   (`scripts/functions/check-guards.ts`, run by `pnpm functions:lint`); everything else receives a
 *   client through dependency injection and must pass `user_id` from verified claims.
 * - `adminGatewayClient(jwt)`: the admin's token plus `x-da-admin-gateway`, for `admin_api` RPCs
 *   (BACKOFFICE_PLAN §2.5 step 4).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../errors.ts';
import { processEnv, type RawEnv, supabaseRuntimeKeys } from '../env.ts';

export type DbClient = SupabaseClient;

export interface ClientConfig {
  readonly url: string;
  readonly publishableKey: string | null;
  readonly secretKey: string | null;
  readonly fetch?: typeof fetch;
}

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function clientConfigFromEnv(raw: RawEnv = processEnv()): ClientConfig {
  const url = raw.SUPABASE_URL?.trim() ?? '';
  if (url === '')
    throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'supabase_url_missing' } });
  return supabaseRuntimeKeys(raw, url);
}

function requireKey(key: string | null, which: string): string {
  if (key === null) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'database', credential_keys: [which] },
    });
  }
  return key;
}

/** RLS-scoped client for one request. */
export function userClient(jwt: string, config: ClientConfig = clientConfigFromEnv()): DbClient {
  return createClient(config.url, requireKey(config.publishableKey, 'SUPABASE_PUBLISHABLE_KEYS'), {
    auth: AUTH_OPTIONS,
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    },
  });
}

/** Unauthenticated client (publishable key) used for `auth.getClaims` verification. */
export function publicClient(config: ClientConfig = clientConfigFromEnv()): DbClient {
  return createClient(config.url, requireKey(config.publishableKey, 'SUPABASE_PUBLISHABLE_KEYS'), {
    auth: AUTH_OPTIONS,
    global: config.fetch === undefined ? {} : { fetch: config.fetch },
  });
}

let cachedService: { config: ClientConfig; client: DbClient } | null = null;

/** Secret-key client (bypasses RLS). Import only from allow-listed modules. */
export function serviceClient(config: ClientConfig = clientConfigFromEnv()): DbClient {
  if (
    cachedService?.config.url === config.url &&
    cachedService.config.secretKey === config.secretKey
  ) {
    return cachedService.client;
  }
  const client = createClient(config.url, requireKey(config.secretKey, 'SUPABASE_SECRET_KEY'), {
    auth: AUTH_OPTIONS,
    global: config.fetch === undefined ? {} : { fetch: config.fetch },
  });
  cachedService = { config, client };
  return client;
}

/** Admin-scoped client for `admin_api` functions (JWT + gateway header; `rpc()` selects the schema). */
export function adminGatewayClient(
  jwt: string,
  gatewaySecret: string,
  config: ClientConfig = clientConfigFromEnv(),
): DbClient {
  return createClient(config.url, requireKey(config.publishableKey, 'SUPABASE_PUBLISHABLE_KEYS'), {
    auth: AUTH_OPTIONS,
    global: {
      headers: { Authorization: `Bearer ${jwt}`, 'x-da-admin-gateway': gatewaySecret },
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    },
  });
}
