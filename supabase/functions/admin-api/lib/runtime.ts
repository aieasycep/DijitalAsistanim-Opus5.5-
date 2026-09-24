/**
 * `admin-api` runtime dependencies (IMPLEMENTATION_PLAN T-10.01): clients, secrets and stores the
 * request pipeline and the module routes use. `index.ts` builds the production runtime; tests pass
 * the same shape with supabase-js clients over a stubbed `fetch`.
 */
import type { AppEnv as AppEnvName } from '@da/validation';
import type { TokenVerifier } from '../../_shared/auth/user.ts';
import type { TokenKeyring } from '../../_shared/crypto/token-cipher.ts';
import type { ClientConfig, DbClient } from '../../_shared/db/clients.ts';
import type { RawEnv } from '../../_shared/env.ts';
import type { IdempotencyRepo } from '../../_shared/idempotency.ts';
import type { RateLimitStore } from '../../_shared/ratelimit.ts';
import type { AiProviderSet } from '../../_shared/ai/providers/index.ts';

/** The admin boundary secrets and settings (INTEGRATION_PLAN §15, BACKOFFICE_PLAN §2.7). */
export interface AdminEnv {
  readonly appEnv: AppEnvName;
  /** The raw environment, for credential checks (names only) and the AI provider set. */
  readonly raw: RawEnv;
  /** `SUPABASE_URL` without a trailing slash. */
  readonly supabaseUrl: string;
  readonly bffSecret: string | undefined;
  readonly gatewaySecret: string | undefined;
  /** `ADMIN_ORIGIN`: the backoffice origin used in invite links. */
  readonly adminOrigin: string | undefined;
  /** `ADMIN_ALLOWED_EMAIL_DOMAINS` (lower case); empty = any domain. */
  readonly allowedEmailDomains: readonly string[];
  readonly recoveryCodePepper: string | undefined;
  readonly piiLookupPepper: string | undefined;
  /** `HASH_PEPPER` (IP hashes of admin sessions). */
  readonly hashPepper: string;
  /** `CRON_SECRET` (worker poke). */
  readonly cronSecret: string | undefined;
  /** `API_PUBLIC_BASE_URL` (falls back to `SUPABASE_URL`) for function-to-function calls. */
  readonly functionsBaseUrl: string;
}

export interface AdminRuntime {
  readonly env: AdminEnv;
  /** Supabase URL and keys; `fetch` is injected in tests. */
  readonly config: ClientConfig;
  /** Service-role client: Auth admin, BFF sign-in functions, rate limits, idempotency, jobs. */
  readonly system: DbClient;
  readonly verifier: TokenVerifier;
  readonly idempotency: IdempotencyRepo;
  readonly rateLimits: RateLimitStore;
  /** Outbound fetch for the worker poke and the `health` run. */
  readonly fetch: typeof fetch;
  /** AI adapters for the synthetic model probe and prompt dry run (fixture mode in tests). */
  readonly ai: AiProviderSet;
  /** The token keyring, used to seal invite tokens inside `transactional_email` payloads. */
  readonly keyring: () => Promise<TokenKeyring>;
  readonly now: () => number;
}

/** Parses `ADMIN_ALLOWED_EMAIL_DOMAINS` (comma list). */
export function parseDomains(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
}

function optional(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v === undefined || v === '' ? undefined : v;
}

export function adminEnvFrom(raw: RawEnv, appEnv: AppEnvName): AdminEnv {
  const supabaseUrl = (raw.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const publicBase = optional(raw.API_PUBLIC_BASE_URL)?.replace(/\/+$/, '');
  return {
    appEnv,
    raw,
    supabaseUrl,
    bffSecret: optional(raw.ADMIN_BFF_SECRET),
    gatewaySecret: optional(raw.ADMIN_GATEWAY_SECRET),
    adminOrigin: optional(raw.ADMIN_ORIGIN)?.replace(/\/+$/, ''),
    allowedEmailDomains: parseDomains(raw.ADMIN_ALLOWED_EMAIL_DOMAINS),
    recoveryCodePepper: optional(raw.RECOVERY_CODE_PEPPER),
    piiLookupPepper: optional(raw.PII_LOOKUP_PEPPER),
    hashPepper: raw.HASH_PEPPER ?? '',
    cronSecret: optional(raw.CRON_SECRET),
    functionsBaseUrl: publicBase ?? supabaseUrl,
  };
}
