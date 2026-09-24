/**
 * Server environment for the Edge Functions (IMPLEMENTATION_PLAN T-3.02, INTEGRATION_PLAN §15,
 * `.env.example`). The zod schema lives in `@da/validation` (`serverEnv`); it is parsed once per
 * isolate and per function. Missing provider credentials never fail at boot: callers ask
 * `credentialStatus(name)` and surface `external_credential_required`. Only the core Supabase URL,
 * `HASH_PEPPER` and the active token-encryption key are required.
 */
import {
  type AppEnv,
  AppEnv as AppEnvSchema,
  parseServerEnv,
  type ServerEnv,
} from '@da/validation';

export type RawEnv = Readonly<Record<string, string | undefined>>;

export interface FunctionEnv extends ServerEnv {
  readonly APP_ENV: AppEnv;
}

/** Reads the process environment (`Deno.env`); tests pass explicit objects instead. */
export function processEnv(): RawEnv {
  try {
    return Deno.env.toObject();
  } catch {
    return {};
  }
}

function readAppEnv(raw: RawEnv): AppEnv {
  const parsed = AppEnvSchema.safeParse(raw.APP_ENV?.trim());
  return parsed.success ? parsed.data : 'development';
}

/** Parses the server env; throws with key names only (never values) when it is invalid. */
export function parseFunctionEnv(raw: RawEnv): FunctionEnv {
  return { ...parseServerEnv(raw), APP_ENV: readAppEnv(raw) };
}

let cached: { raw: RawEnv; env: FunctionEnv } | null = null;

/** Memoised per isolate; the first call validates the whole environment. */
export function loadEnv(raw: RawEnv = processEnv()): FunctionEnv {
  if (cached?.raw === raw) return cached.env;
  const env = parseFunctionEnv(raw);
  cached = { raw, env };
  return env;
}

export function isProduction(env: Pick<FunctionEnv, 'APP_ENV'>): boolean {
  return env.APP_ENV === 'production';
}

// ── Credentials ──────────────────────────────────────────────────────────────

/**
 * External credentials by feature. `required` keys must all be present; `oneOf` groups need at
 * least one key each. Names only: values are never returned or logged.
 */
export const CREDENTIALS = {
  supabase_secret: { required: ['SUPABASE_SECRET_KEY'] },
  anthropic: { required: ['ANTHROPIC_API_KEY'] },
  anthropic_admin: { required: ['ANTHROPIC_ADMIN_API_KEY'] },
  openai: { required: ['OPENAI_API_KEY'] },
  openai_admin: { required: ['OPENAI_ADMIN_API_KEY'] },
  voyage: { required: ['VOYAGE_API_KEY'] },
  ai_hash_pepper: { required: ['AI_HASH_PEPPER'] },
  /** Deepgram STT (`STT_SERVER_PROVIDER=deepgram`); the OpenAI STT path uses `openai`. */
  deepgram: { required: ['STT_API_KEY'] },
  /** Azure / ElevenLabs premium TTS (`TTS_PREMIUM_PROVIDER`); the OpenAI TTS path uses `openai`. */
  tts_premium: { required: ['TTS_PREMIUM_PROVIDER', 'TTS_API_KEY'] },
  google_oauth: {
    required: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'],
  },
  google_pubsub: {
    required: [
      'GOOGLE_PUBSUB_TOPIC',
      'GOOGLE_PUBSUB_PUSH_AUDIENCE',
      'GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT',
    ],
  },
  google_calendar_webhook: { required: ['GOOGLE_CALENDAR_WEBHOOK_URL', 'WEBHOOK_HMAC_SECRET'] },
  microsoft_oauth: {
    required: [
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CERT_PRIVATE_KEY',
      'MICROSOFT_CERT_THUMBPRINT_S256',
      'MICROSOFT_OAUTH_REDIRECT_URI',
    ],
  },
  microsoft_graph_webhook: {
    required: ['MICROSOFT_GRAPH_NOTIFICATION_URL', 'MICROSOFT_GRAPH_LIFECYCLE_URL'],
  },
  apple_siwa: {
    required: [
      'APPLE_TEAM_ID',
      'APPLE_SIWA_KEY_ID',
      'APPLE_SIWA_PRIVATE_KEY',
      'APPLE_SIWA_NATIVE_CLIENT_ID',
    ],
  },
  revenuecat: { required: ['REVENUECAT_PROJECT_ID', 'REVENUECAT_API_V2_SECRET_KEY'] },
  revenuecat_webhook: { required: ['REVENUECAT_WEBHOOK_AUTH'] },
  expo_push: { required: ['EXPO_ACCESS_TOKEN'] },
  sentry: { required: ['SENTRY_DSN'] },
  cron_secret: { required: ['CRON_SECRET'] },
  webhook_hmac: { required: ['WEBHOOK_HMAC_SECRET'] },
  admin_bff: { required: ['ADMIN_BFF_SECRET', 'ADMIN_GATEWAY_SECRET'] },
  email_delivery: { required: ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS'] },
  turnstile: { required: ['TURNSTILE_SECRET_KEY'] },
} as const satisfies Record<string, { required: readonly string[] }>;

export type CredentialName = keyof typeof CREDENTIALS;

export type CredentialState = 'configured' | 'external_credential_required';

export interface CredentialStatus {
  readonly name: CredentialName;
  readonly status: CredentialState;
  /** Missing key names (never values). */
  readonly missing: readonly string[];
}

function present(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== 'none';
  return value !== undefined && value !== null;
}

/**
 * `configured` when every key of the credential is set, else `external_credential_required`
 * with the missing key names. Accepts a parsed env or a raw env object.
 */
export function credentialStatus(
  name: CredentialName,
  env: Readonly<Record<string, unknown>>,
): CredentialStatus {
  const missing = CREDENTIALS[name].required.filter((key) => !present(env[key]));
  return {
    name,
    status: missing.length === 0 ? 'configured' : 'external_credential_required',
    missing,
  };
}

export function isConfigured(
  name: CredentialName,
  env: Readonly<Record<string, unknown>>,
): boolean {
  return credentialStatus(name, env).status === 'configured';
}

// ── Platform-injected Supabase keys ──────────────────────────────────────────

export interface SupabaseRuntimeKeys {
  readonly url: string;
  /** `sb_publishable_…` (or the legacy anon key): user-scoped clients and `auth.getClaims`. */
  readonly publishableKey: string | null;
  /** `sb_secret_…` (or the legacy service-role key): the service client only. */
  readonly secretKey: string | null;
}

function firstKeyOfJsonMap(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const map = parsed as Record<string, unknown>;
    const preferred = map.default ?? Object.values(map)[0];
    return typeof preferred === 'string' && preferred !== '' ? preferred : null;
  } catch {
    return null;
  }
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

/**
 * Supabase keys. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` come from our env (INTEGRATION_PLAN §15);
 * the Edge runtime also injects `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` (JSON maps)
 * and the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, used as fallbacks.
 */
export function supabaseRuntimeKeys(raw: RawEnv, url: string): SupabaseRuntimeKeys {
  return {
    url,
    publishableKey:
      firstKeyOfJsonMap(raw.SUPABASE_PUBLISHABLE_KEYS) ?? nonEmpty(raw.SUPABASE_ANON_KEY) ?? null,
    secretKey:
      nonEmpty(raw.SUPABASE_SECRET_KEY) ??
      firstKeyOfJsonMap(raw.SUPABASE_SECRET_KEYS) ??
      nonEmpty(raw.SUPABASE_SERVICE_ROLE_KEY) ??
      null,
  };
}
