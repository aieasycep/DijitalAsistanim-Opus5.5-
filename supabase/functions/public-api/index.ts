/** `public-api` Edge Function entrypoint (`verify_jwt = false`; rate limits and CORS in code). */
import { supabaseClaimsVerifier } from '../_shared/auth/user.ts';
import { clientConfigFromEnv, publicClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { createPublicApiApp } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const config = clientConfigFromEnv(raw);
const app = createPublicApiApp({
  webOrigin: env.PUBLIC_WEB_URL,
  verifier: config.publishableKey === null ? null : supabaseClaimsVerifier(publicClient(config)),
  log: createLogger({ fn: 'public-api' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
