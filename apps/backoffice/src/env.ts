import 'server-only';

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';
import { AppEnv, CLIENT_SECRET_SHAPES } from '@da/validation/env';

/*
 * Backoffice environment (INTEGRATION_PLAN §15, BACKOFFICE_PLAN §2.7). Read lazily at request time so
 * `next build` works without runtime secrets, and always through dynamic keys so Next never inlines
 * a value into any bundle. The browser receives no environment value at all: the Supabase URL and
 * publishable key are `NEXT_PUBLIC_*` by name but are read only by server code (Auth calls run in
 * server actions). The backoffice must never hold the Supabase secret key or any other
 * server-to-database credential (ADR-06): their presence is a boot error.
 */

const HttpUrl = z.url({ protocol: /^https?$/ });

const SERVER_SHAPE = {
  APP_ENV: AppEnv.default('development'),
  /** `https://api.<domain>`; admin-api lives at `${API_PUBLIC_BASE_URL}/functions/v1/admin-api`. */
  API_PUBLIC_BASE_URL: HttpUrl,
  /** Shared secret for BO → admin-api calls (`x-da-bff`); also keys the auth-cookie sealing. */
  ADMIN_BFF_SECRET: z.string().min(32),
  /** `https://admin.<domain>`: the only Origin accepted for mutations. */
  ADMIN_ORIGIN: HttpUrl,
};

const CLIENT_SHAPE = {
  NEXT_PUBLIC_SUPABASE_URL: HttpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
};

const KEYS = [...Object.keys(SERVER_SHAPE), ...Object.keys(CLIENT_SHAPE)] as const;

/**
 * Key names the backoffice refuses to boot with. They belong to Edge Functions, CI or the database
 * (SECURITY_AND_PRIVACY_PLAN §3 boundaries): the Supabase secret key and DB URL, token encryption
 * keys, peppers, the admin gateway secret and provider secrets.
 */
export const FORBIDDEN_ENV_KEYS: readonly RegExp[] = [
  /^SUPABASE_(SECRET|SERVICE_ROLE)_KEY$/,
  /^SUPABASE_DB_URL$/,
  /^TOKEN_ENC_KEY_V\d+$/,
  /_PEPPER$/,
  /^ADMIN_GATEWAY_SECRET$/,
  /^WEBHOOK_HMAC_SECRET$/,
  /^CRON_SECRET$/,
  /^(ANTHROPIC|OPENAI)_(ADMIN_)?API_KEY$/,
  /^REVENUECAT_API_V[12]_SECRET_KEY$/,
];

export interface BackofficeEnv {
  readonly APP_ENV: z.infer<typeof AppEnv>;
  readonly API_PUBLIC_BASE_URL: string;
  readonly ADMIN_BFF_SECRET: string;
  readonly ADMIN_ORIGIN: string;
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  /** `${API_PUBLIC_BASE_URL}/functions/v1/admin-api`, without a trailing slash. */
  readonly adminApiBaseUrl: string;
}

/** Names of forbidden keys or secret-shaped values present in `raw` (never the values). */
export function findForbiddenEnv(raw: Readonly<Record<string, string | undefined>>): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value.trim() === '') continue;
    if (FORBIDDEN_ENV_KEYS.some((pattern) => pattern.test(key))) {
      found.push(key);
      continue;
    }
    if (CLIENT_SECRET_SHAPES.some((shape) => shape.test(value)) && /(KEY|SECRET|TOKEN)/.test(key)) {
      found.push(key);
    }
  }
  return found.sort();
}

function snapshot(
  raw: Readonly<Record<string, string | undefined>>,
): Record<(typeof KEYS)[number], string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of KEYS) out[key] = raw[key];
  return out;
}

/**
 * Validates a raw environment. Throws with key names and rule codes only (UT-ENV-01): a missing or
 * malformed key, a forbidden secret, or a non-https URL in production.
 */
export function parseBackofficeEnv(
  raw: Readonly<Record<string, string | undefined>>,
): BackofficeEnv {
  const forbidden = findForbiddenEnv(raw);
  if (forbidden.length > 0) {
    throw new Error(
      `Invalid environment: the backoffice must not hold ${forbidden.join(', ')} (forbidden_secret)`,
    );
  }
  const env = createEnv({
    server: SERVER_SHAPE,
    client: CLIENT_SHAPE,
    runtimeEnv: snapshot(raw),
    emptyStringAsUndefined: true,
    isServer: true,
    onValidationError: (issues) => {
      const keys = issues.map((issue) => (issue.path ?? []).map(String).join('.') || '(root)');
      throw new Error(`Invalid environment: ${[...new Set(keys)].sort().join(', ')}`);
    },
  });
  if (env.APP_ENV === 'production') {
    const insecure = (['API_PUBLIC_BASE_URL', 'ADMIN_ORIGIN', 'NEXT_PUBLIC_SUPABASE_URL'] as const)
      .filter((key) => !env[key].startsWith('https://'))
      .map((key) => `${key} (https_required_in_production)`);
    if (insecure.length > 0) throw new Error(`Invalid environment: ${insecure.join(', ')}`);
  }
  return {
    APP_ENV: env.APP_ENV,
    API_PUBLIC_BASE_URL: env.API_PUBLIC_BASE_URL,
    ADMIN_BFF_SECRET: env.ADMIN_BFF_SECRET,
    ADMIN_ORIGIN: new URL(env.ADMIN_ORIGIN).origin,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ''),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    adminApiBaseUrl: `${env.API_PUBLIC_BASE_URL.replace(/\/+$/, '')}/functions/v1/admin-api`,
  };
}

let cached: BackofficeEnv | undefined;

/** The validated environment of this process (validated once, on first use at request time). */
export function serverEnv(): BackofficeEnv {
  cached ??= parseBackofficeEnv(process.env);
  return cached;
}
