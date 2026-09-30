/**
 * Client environment (INTEGRATION_PLAN §15, SECURITY_AND_PRIVACY_PLAN key rules). The app reads
 * only the client-safe `EXPO_PUBLIC_*` allow-list and validates it with `@da/validation`'s
 * `clientEnv.expo`, which also refuses secret-shaped values, demo mode and the Test Store key in
 * production. Server-only and build-time keys are never referenced from app code.
 */
import { clientEnv, formatEnvError, type ExpoClientEnv } from '@da/validation/env';

import { DEFAULT_WEB_URL, variantScheme } from './variant';

export type RawClientEnv = Readonly<Record<string, string | undefined>>;

/**
 * The `EXPO_PUBLIC_*` values as bundled. Expo inlines only static member reads of these keys on
 * `process.env` (at bundle time, and in Jest at transform time), so every allow-listed key is
 * spelled out; `test/env.test.ts` keeps this list equal to `ENV_KEYS.expo_client`.
 */
export function readExpoPublicEnv(): RawClientEnv {
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
    EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
    EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_ANALYTICS_ENABLED: process.env.EXPO_PUBLIC_ANALYTICS_ENABLED,
    EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_APP_SCHEME: process.env.EXPO_PUBLIC_APP_SCHEME,
    EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
    EXPO_PUBLIC_DEMO_MODE: process.env.EXPO_PUBLIC_DEMO_MODE,
  };
}

/**
 * Validates raw values. The scheme gets the variant suffix exactly as `app.config.ts` gives the
 * native project, so links built from it always reach this build. Errors name keys, never values.
 */
export function parseClientEnv(raw: RawClientEnv): ExpoClientEnv {
  const result = clientEnv.expo.safeParse(raw);
  if (!result.success) throw new Error(formatEnvError(result.error));
  const env = result.data;
  return {
    ...env,
    EXPO_PUBLIC_APP_SCHEME: variantScheme(env.EXPO_PUBLIC_APP_SCHEME, env.EXPO_PUBLIC_APP_ENV),
  };
}

let cached: ExpoClientEnv | undefined;

/** The validated client environment of this build (parsed once). */
export function getClientEnv(): ExpoClientEnv {
  cached ??= parseClientEnv(readExpoPublicEnv());
  return cached;
}

/** The web origin (`EXPO_PUBLIC_WEB_URL`, default M§108) without a trailing slash. */
export function webOrigin(env: ExpoClientEnv = getClientEnv()): string {
  return (env.EXPO_PUBLIC_WEB_URL ?? DEFAULT_WEB_URL).replace(/\/+$/, '');
}

/** A page on the public web site, e.g. `webPage('/terms')`. */
export function webPage(path: `/${string}`, env: ExpoClientEnv = getClientEnv()): string {
  return `${webOrigin(env)}${path}`;
}

/** `dijitalasistan[-variant]://<path>` for this build's scheme. */
export function appLink(path: string, env: ExpoClientEnv = getClientEnv()): string {
  return `${env.EXPO_PUBLIC_APP_SCHEME}://${path.replace(/^\/+/, '')}`;
}

/** Demo builds only (`EXPO_PUBLIC_DEMO_MODE=true`; refused in production by the env schema). */
export function isDemoBuild(env: ExpoClientEnv = getClientEnv()): boolean {
  return env.EXPO_PUBLIC_DEMO_MODE;
}
