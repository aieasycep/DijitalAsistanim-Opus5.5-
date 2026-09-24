/**
 * `oauth` Edge Function entrypoint (`/functions/v1/oauth`, `verify_jwt = false`; API_CONTRACTS §9).
 * Authentication is the single-use `oauth_states` row plus PKCE, checked per callback. The provider
 * callbacks (OAUTH-01…OAUTH-04) are registered by the integration tasks; unknown paths answer
 * `NOT_FOUND`.
 */
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createApp } from '../_shared/http/app.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const app = createApp({
  fn: 'oauth',
  logger: createLogger({ fn: 'oauth' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
