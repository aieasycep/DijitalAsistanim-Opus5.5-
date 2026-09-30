/**
 * `oauth` Edge Function entrypoint (`/functions/v1/oauth`, `verify_jwt = false`; API_CONTRACTS §9).
 * Authentication is the single-use `oauth_states` row plus PKCE, checked per callback (OAUTH-01…04).
 */
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed, isDemoEnabled } from '../_shared/providers/demo/guard.ts';
import { createIntegrationWiring } from '../_shared/system/integrations.ts';
import { createOAuthApp } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const log = createLogger({ fn: 'oauth' });
const wiring = createIntegrationWiring({
  env,
  raw,
  system: serviceClient(clientConfigFromEnv(raw)),
  log,
});
const app = createOAuthApp({
  runtime: wiring.runtime,
  demoEnabled: isDemoEnabled(raw),
  log,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
