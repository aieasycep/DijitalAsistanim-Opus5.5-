import { z } from 'zod';

/*
 * Environment schemas (docs/INTEGRATION_PLAN.md §15, `.env.example`, TEST_PLAN §2.15 UT-ENV-01..07).
 * Every `.env.example` key belongs to exactly one schema, matching its tag:
 * - `# client-safe`  → `clientEnv.expo` (EXPO_PUBLIC_*) or `clientEnv.next` (NEXT_PUBLIC_*)
 * - `# SERVER-ONLY`  → `serverEnv` (Edge Functions, server runtimes, scripts)
 * - `# build-time`   → `buildEnv` (CI / EAS / Vercel tooling)
 * Empty values (`KEY=`) count as unset. Missing provider credentials never fail at boot; the adapters
 * report `EXTERNAL_CREDENTIAL_REQUIRED` at use time. Only the core Supabase URL and the crypto keys are
 * required on the server. Error messages name keys, never values.
 */

export const APP_ENV_VALUES = ['development', 'preview', 'e2e', 'production'] as const;
export const AppEnv = z.enum(APP_ENV_VALUES);
export type AppEnv = z.infer<typeof AppEnv>;

type RawEnv = Readonly<Record<string, string | undefined>>;

/** Drops unset and empty values so `KEY=` behaves like an absent key. */
export function stripEmptyEnv(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
  }
  return out;
}

// ── Value shapes ─────────────────────────────────────────────────────────────
const BoolFlag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const HttpUrl = z.url({ protocol: /^https?$/ });
const PostgresUrl = z.string().regex(/^postgres(ql)?:\/\/\S+$/);
const Email = z.email();
const Secret = (min = 16) => z.string().min(min);
const NotAfter = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const Pem = z
  .string()
  .regex(/-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (RSA |EC )?PRIVATE KEY-----/);
const AppleId10 = z.string().regex(/^[A-Z0-9]{10}$/);
const Hostname = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
/** 32 random bytes as base64 (standard or URL-safe, padded or not). */
export const EncryptionKey32 = z
  .string()
  .regex(/^[A-Za-z0-9+/_-]{43}=?$/, 'must_be_32_bytes_base64');
const GoogleClientId = z.string().regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
const DomainList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d !== ''),
  )
  .pipe(z.array(Hostname).min(1));

// ── serverEnv ────────────────────────────────────────────────────────────────
export const serverEnvShape = {
  // Supabase
  SUPABASE_URL: HttpUrl,
  SUPABASE_SECRET_KEY: z
    .string()
    .regex(/^sb_secret_[A-Za-z0-9_-]+$/)
    .optional(),
  SUPABASE_DB_URL: PostgresUrl.optional(),
  SUPABASE_AUTH_SMTP_HOST: Hostname.optional(),
  SUPABASE_AUTH_SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SUPABASE_AUTH_SMTP_USER: z.string().optional(),
  SUPABASE_AUTH_SMTP_PASS: z.string().optional(),
  SUPABASE_AUTH_SMTP_SENDER: Email.optional(),
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: z.string().optional(),
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: z.string().optional(),
  SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID: z.uuid().optional(),
  SUPABASE_AUTH_EXTERNAL_AZURE_SECRET: z.string().optional(),
  SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID: z.string().optional(),
  SUPABASE_AUTH_EXTERNAL_APPLE_SECRET: z.string().optional(),
  // Google
  GOOGLE_CLOUD_PROJECT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)
    .optional(),
  GOOGLE_OAUTH_CLIENT_ID: GoogleClientId.optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: HttpUrl.optional(),
  GOOGLE_PUBSUB_TOPIC: z
    .string()
    .regex(/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.~+%-]{2,254}$/)
    .optional(),
  GOOGLE_PUBSUB_PUSH_AUDIENCE: HttpUrl.optional(),
  GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT: Email.optional(),
  GOOGLE_CALENDAR_WEBHOOK_URL: HttpUrl.optional(),
  GOOGLE_CASA_LOA_NOT_AFTER: NotAfter.optional(),
  // Microsoft
  MICROSOFT_CLIENT_ID: z.uuid().optional(),
  MICROSOFT_AUTHORITY_TENANT: z
    .string()
    .regex(/^(common|organizations|consumers|[0-9a-f-]{36})$/)
    .default('common'),
  MICROSOFT_CERT_PRIVATE_KEY: Pem.optional(),
  MICROSOFT_CERT_THUMBPRINT_S256: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
  MICROSOFT_CERT_NOT_AFTER: NotAfter.optional(),
  MICROSOFT_LOGIN_SECRET_NOT_AFTER: NotAfter.optional(),
  MICROSOFT_OAUTH_REDIRECT_URI: HttpUrl.optional(),
  MICROSOFT_GRAPH_NOTIFICATION_URL: HttpUrl.optional(),
  MICROSOFT_GRAPH_LIFECYCLE_URL: HttpUrl.optional(),
  // Apple
  APPLE_TEAM_ID: AppleId10.optional(),
  APPLE_SIWA_KEY_ID: AppleId10.optional(),
  APPLE_SIWA_PRIVATE_KEY: Pem.optional(),
  APPLE_SIWA_NATIVE_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9.-]+$/)
    .optional(),
  APPLE_SIWA_SERVICES_ID: z
    .string()
    .regex(/^[A-Za-z0-9.-]+$/)
    .optional(),
  APPLE_SIWA_WEB_SECRET_NOT_AFTER: NotAfter.optional(),
  // AI
  ANTHROPIC_API_KEY: z
    .string()
    .regex(/^sk-ant-/)
    .optional(),
  ANTHROPIC_ADMIN_API_KEY: z
    .string()
    .regex(/^sk-ant-/)
    .optional(),
  OPENAI_API_KEY: z.string().regex(/^sk-/).optional(),
  OPENAI_ADMIN_API_KEY: z.string().regex(/^sk-/).optional(),
  AI_FIXTURE_PROVIDER_ENABLED: BoolFlag.default(false),
  AI_HASH_PEPPER: Secret(32).optional(),
  // Embeddings, STT, TTS
  VOYAGE_API_KEY: z.string().optional(),
  STT_SERVER_PROVIDER: z.enum(['openai', 'deepgram']).optional(),
  STT_API_KEY: z.string().optional(),
  TTS_PREMIUM_PROVIDER: z.enum(['none', 'azure', 'openai', 'elevenlabs']).default('none'),
  TTS_API_KEY: z.string().optional(),
  // RevenueCat
  REVENUECAT_PROJECT_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  REVENUECAT_API_V2_SECRET_KEY: z.string().regex(/^sk_/).optional(),
  REVENUECAT_ENTITLEMENT_PRO_ID: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .default('pro'),
  REVENUECAT_API_V1_SECRET_KEY: z.string().regex(/^sk_/).optional(),
  REVENUECAT_WEBHOOK_AUTH: Secret().optional(),
  // Observability, analytics, push
  SENTRY_DSN: HttpUrl.optional(),
  ANALYTICS_EXTERNAL_ADAPTER: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .default('none'),
  ANALYTICS_EXTERNAL_WRITE_KEY: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Encryption and webhook secrets
  TOKEN_ENC_KEY_V1: EncryptionKey32.optional(),
  TOKEN_ENC_ACTIVE_VERSION: z.coerce.number().int().min(1).default(1),
  HASH_PEPPER: Secret(32),
  CRON_SECRET: Secret().optional(),
  WEBHOOK_HMAC_SECRET: Secret(32).optional(),
  // Admin boundary
  ADMIN_BFF_SECRET: Secret(32).optional(),
  ADMIN_GATEWAY_SECRET: Secret(32).optional(),
  ADMIN_ORIGIN: HttpUrl.optional(),
  ADMIN_ALLOWED_EMAIL_DOMAINS: DomainList.optional(),
  RECOVERY_CODE_PEPPER: Secret(32).optional(),
  PII_LOOKUP_PEPPER: Secret(32).optional(),
  AUDIT_SUBJECT_PEPPER: Secret(32).optional(),
  // Transactional email
  EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'ses']).optional(),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: Email.optional(),
  EMAIL_REPLY_TO: Email.optional(),
  EMAIL_INBOUND_BASIC_AUTH: z
    .string()
    .regex(/^[^:\s]+:\S{12,}$/)
    .optional(),
  // Public web
  DATA_REGION_LABEL: z.string().max(60).optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  // App URLs
  PUBLIC_WEB_URL: HttpUrl.optional(),
  API_PUBLIC_BASE_URL: HttpUrl.optional(),
  OAUTH_RESULT_REDIRECT_URI: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*:\/\/\S+$/)
    .optional(),
  MAIL_MESSAGE_ID_DOMAIN: Hostname.optional(),
  // Demo mode
  DEMO_MODE: BoolFlag.default(false),
  ALLOW_DEMO_IN_PRODUCTION: BoolFlag.default(false),
};

const SERVER_HTTPS_KEYS = [
  'SUPABASE_URL',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_PUBSUB_PUSH_AUDIENCE',
  'GOOGLE_CALENDAR_WEBHOOK_URL',
  'MICROSOFT_OAUTH_REDIRECT_URI',
  'MICROSOFT_GRAPH_NOTIFICATION_URL',
  'MICROSOFT_GRAPH_LIFECYCLE_URL',
  'SENTRY_DSN',
  'ADMIN_ORIGIN',
  'PUBLIC_WEB_URL',
  'API_PUBLIC_BASE_URL',
] as const;

const TOKEN_KEY_PATTERN = /^TOKEN_ENC_KEY_V([1-9]\d*)$/;
/** Test-only knobs that must never be present in `preview` or `production` (UT-ENV-05). */
const TEST_ONLY_KEY = (key: string) =>
  key === 'DA_FIXED_NOW' || (key.endsWith('_BASE_URL') && key !== 'API_PUBLIC_BASE_URL');

function readAppEnv(raw: Record<string, string>): AppEnv {
  const parsed = AppEnv.safeParse(raw.APP_ENV);
  return parsed.success ? parsed.data : 'development';
}

const serverEnvObject = z.looseObject(serverEnvShape);

export type ServerEnv = z.infer<typeof serverEnvObject> & {
  /** Every `TOKEN_ENC_KEY_V{n}` present, by version (the active one is guaranteed). */
  readonly token_encryption_keys: Readonly<Record<number, string>>;
};

/**
 * Server env: the SERVER-ONLY keys plus `TOKEN_ENC_KEY_V{n}` rotation keys. `APP_ENV` (a build-time
 * key) is read from the same environment for the production guards: demo mode needs
 * `ALLOW_DEMO_IN_PRODUCTION`, URLs must be `https:`, the fixture AI provider and test-only overrides
 * are refused.
 */
export const serverEnv = z.preprocess(
  stripEmptyEnv,
  serverEnvObject
    .superRefine((env, ctx) => {
      const raw = env as Record<string, string | undefined>;
      const appEnv = readAppEnv(raw as Record<string, string>);
      const versions = Object.keys(raw)
        .map((key) => TOKEN_KEY_PATTERN.exec(key))
        .filter((m): m is RegExpExecArray => m !== null);
      for (const match of versions) {
        if (!EncryptionKey32.safeParse(raw[match[0]]).success) {
          ctx.addIssue({ code: 'custom', path: [match[0]], message: 'must_be_32_bytes_base64' });
        }
      }
      const activeKey = `TOKEN_ENC_KEY_V${env.TOKEN_ENC_ACTIVE_VERSION}`;
      if (raw[activeKey] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [activeKey],
          message: 'active_encryption_key_missing',
        });
      }
      const production = appEnv === 'production';
      if (production && env.DEMO_MODE && !env.ALLOW_DEMO_IN_PRODUCTION) {
        ctx.addIssue({ code: 'custom', path: ['DEMO_MODE'], message: 'demo_mode_in_production' });
      }
      if (production && env.AI_FIXTURE_PROVIDER_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_FIXTURE_PROVIDER_ENABLED'],
          message: 'fixture_provider_in_production',
        });
      }
      if (production) {
        for (const key of SERVER_HTTPS_KEYS) {
          const value = raw[key];
          if (typeof value === 'string' && !value.startsWith('https://')) {
            ctx.addIssue({ code: 'custom', path: [key], message: 'https_required_in_production' });
          }
        }
      }
      if (appEnv === 'preview' || appEnv === 'production') {
        for (const key of Object.keys(raw).filter(TEST_ONLY_KEY)) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'test_only_override' });
        }
      }
    })
    .transform((env): ServerEnv => {
      const raw = env as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const key of Object.keys(serverEnvShape)) {
        if (raw[key] !== undefined) picked[key] = raw[key];
      }
      const keys: Record<number, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        const match = TOKEN_KEY_PATTERN.exec(key);
        if (match?.[1] !== undefined && typeof value === 'string') keys[Number(match[1])] = value;
      }
      return { ...(picked as z.infer<typeof serverEnvObject>), token_encryption_keys: keys };
    }),
);

// ── clientEnv ────────────────────────────────────────────────────────────────
/**
 * Secret shapes that must never appear in a client-safe variable (UT-ENV-02): Supabase secret keys,
 * Anthropic/OpenAI keys, RevenueCat v2 secret keys and PEM material.
 */
export const CLIENT_SECRET_SHAPES: readonly RegExp[] = [
  /sb_secret_/,
  /sk-ant-/,
  /sk-proj-/,
  /^sk-/,
  /^sk_/,
  /-----BEGIN/,
];

function rejectSecretShapes(prefix: string) {
  return (env: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith(prefix) || typeof value !== 'string') continue;
      if (CLIENT_SECRET_SHAPES.some((shape) => shape.test(value))) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'secret_in_client_variable' });
      }
    }
  };
}

export const expoClientEnvShape = {
  EXPO_PUBLIC_SUPABASE_URL: HttpUrl,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: GoogleClientId.optional(),
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: GoogleClientId.optional(),
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: z
    .string()
    .regex(/^appl_[A-Za-z0-9]+$/)
    .optional(),
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: z
    .string()
    .regex(/^goog_[A-Za-z0-9]+$/)
    .optional(),
  EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: z
    .string()
    .regex(/^test_[A-Za-z0-9]+$/)
    .optional(),
  EXPO_PUBLIC_SENTRY_DSN: HttpUrl.optional(),
  EXPO_PUBLIC_ANALYTICS_ENABLED: BoolFlag.default(true),
  EXPO_PUBLIC_EAS_PROJECT_ID: z.uuid().optional(),
  EXPO_PUBLIC_APP_ENV: AppEnv.default('development'),
  EXPO_PUBLIC_APP_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/)
    .default('dijitalasistan'),
  EXPO_PUBLIC_WEB_URL: HttpUrl.optional(),
  EXPO_PUBLIC_DEMO_MODE: BoolFlag.default(false),
};

const expoClientEnvObject = z.looseObject(expoClientEnvShape);
export type ExpoClientEnv = z.infer<z.ZodObject<typeof expoClientEnvShape>>;

/** Mobile (`app.config.ts` allow-list): production builds carry no demo mode and no Test Store key. */
export const expoClientEnv = z.preprocess(
  stripEmptyEnv,
  expoClientEnvObject
    .superRefine((env, ctx) => {
      rejectSecretShapes('EXPO_PUBLIC_')(env, ctx);
      if (env.EXPO_PUBLIC_APP_ENV === 'production') {
        if (env.EXPO_PUBLIC_DEMO_MODE) {
          ctx.addIssue({
            code: 'custom',
            path: ['EXPO_PUBLIC_DEMO_MODE'],
            message: 'demo_mode_in_production',
          });
        }
        if (env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY'],
            message: 'test_store_in_production',
          });
        }
        for (const key of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_WEB_URL'] as const) {
          const value = env[key];
          if (typeof value === 'string' && !value.startsWith('https://')) {
            ctx.addIssue({ code: 'custom', path: [key], message: 'https_required_in_production' });
          }
        }
      }
    })
    .transform((env): ExpoClientEnv => pickKeys(env, expoClientEnvShape) as ExpoClientEnv),
);

export const nextClientEnvShape = {
  NEXT_PUBLIC_SUPABASE_URL: HttpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
  NEXT_PUBLIC_SENTRY_DSN: HttpUrl.optional(),
  NEXT_PUBLIC_ANALYTICS_ENABLED: BoolFlag.default(true),
  NEXT_PUBLIC_SITE_URL: HttpUrl.optional(),
  NEXT_PUBLIC_ADMIN_URL: HttpUrl.optional(),
};

const nextClientEnvObject = z.looseObject(nextClientEnvShape);
export type NextClientEnv = z.infer<z.ZodObject<typeof nextClientEnvShape>>;

/** Web and backoffice client bundles (`@t3-oss/env-nextjs` `client` section). */
export const nextClientEnv = z.preprocess(
  stripEmptyEnv,
  nextClientEnvObject
    .superRefine((env, ctx) => {
      rejectSecretShapes('NEXT_PUBLIC_')(env, ctx);
    })
    .transform((env): NextClientEnv => pickKeys(env, nextClientEnvShape) as NextClientEnv),
);

/** Client-safe env schemas: `expo` (EXPO_PUBLIC_*) and `next` (NEXT_PUBLIC_*). */
export const clientEnv = { expo: expoClientEnv, next: nextClientEnv } as const;

// ── buildEnv ─────────────────────────────────────────────────────────────────
const Fingerprint = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
export const buildEnvShape = {
  SUPABASE_PROJECT_REF: z
    .string()
    .regex(/^[a-z]{20}$/)
    .optional(),
  SUPABASE_ACCESS_TOKEN: z
    .string()
    .regex(/^sbp_[A-Za-z0-9]+$/)
    .optional(),
  GOOGLE_IOS_URL_SCHEME: z
    .string()
    .regex(/^com\.googleusercontent\.apps\.[0-9]+-[a-z0-9]+$/)
    .optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  SENTRY_PROJECT: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  GOOGLE_SERVICES_JSON: z.string().optional(),
  APP_ENV: AppEnv.default('development'),
  IOS_BUNDLE_IDENTIFIER: z
    .string()
    .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/)
    .default('com.dijitalasistan.app'),
  ANDROID_PACKAGE: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/)
    .default('com.dijitalasistan.app'),
  IOS_APP_GROUP: z
    .string()
    .regex(/^group\.[a-z0-9-]+(\.[a-z0-9-]+)+$/)
    .default('group.com.dijitalasistan.app'),
  IOS_APP_STORE_ID: z
    .string()
    .regex(/^\d{6,12}$/)
    .optional(),
  ANDROID_SHA256_CERT_FINGERPRINTS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((f) => f.trim().toUpperCase())
        .filter((f) => f !== ''),
    )
    .pipe(z.array(z.string().regex(Fingerprint)).min(1))
    .optional(),
  EXPO_TOKEN: z.string().optional(),
  EXPO_OWNER: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  EXPO_ASC_API_KEY_PATH: z.string().optional(),
  EXPO_ASC_KEY_ID: AppleId10.optional(),
  EXPO_ASC_ISSUER_ID: z.uuid().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_ORG_ID: z.string().optional(),
  VERCEL_PROJECT_ID_WEB: z.string().optional(),
  VERCEL_PROJECT_ID_BACKOFFICE: z.string().optional(),
};
export type BuildEnv = z.infer<z.ZodObject<typeof buildEnvShape>>;

/** CI / EAS / Vercel build tooling (not shipped as runtime env). */
export const buildEnv = z.preprocess(
  stripEmptyEnv,
  z
    .looseObject(buildEnvShape)
    .transform((env): BuildEnv => pickKeys(env, buildEnvShape) as BuildEnv),
);

function pickKeys(
  env: Record<string, unknown>,
  shape: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) if (env[key] !== undefined) out[key] = env[key];
  return out;
}

// ── Registry and parsing helpers ─────────────────────────────────────────────
export type EnvScope = 'server' | 'expo_client' | 'next_client' | 'build';

/** Key names per schema; each `.env.example` key appears in exactly one list (parity-tested). */
export const ENV_KEYS: Readonly<Record<EnvScope, readonly string[]>> = {
  server: Object.keys(serverEnvShape),
  expo_client: Object.keys(expoClientEnvShape),
  next_client: Object.keys(nextClientEnvShape),
  build: Object.keys(buildEnvShape),
};

/** The `.env.example` tag each scope corresponds to. */
export const ENV_SCOPE_TAG: Readonly<
  Record<EnvScope, 'SERVER-ONLY' | 'client-safe' | 'build-time'>
> = {
  server: 'SERVER-ONLY',
  expo_client: 'client-safe',
  next_client: 'client-safe',
  build: 'build-time',
};

/** Renders an env validation error with key names and rule codes only (never values, UT-ENV-01). */
export function formatEnvError(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    const rule = issue.code === 'custom' ? issue.message : issue.code;
    return `${key} (${rule})`;
  });
  return `Invalid environment: ${parts.join(', ')}`;
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: RawEnv): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(formatEnvError(result.error));
  return result.data;
}

export const parseServerEnv = (raw: RawEnv): ServerEnv => parseOrThrow(serverEnv, raw);
export const parseExpoClientEnv = (raw: RawEnv): ExpoClientEnv => parseOrThrow(expoClientEnv, raw);
export const parseNextClientEnv = (raw: RawEnv): NextClientEnv => parseOrThrow(nextClientEnv, raw);
export const parseBuildEnv = (raw: RawEnv): BuildEnv => parseOrThrow(buildEnv, raw);
