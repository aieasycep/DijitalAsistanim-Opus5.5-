/**
 * `webhooks-google` Edge Function entrypoint (`verify_jwt = false`; API_CONTRACTS §10 WH-01/WH-02).
 * Authenticity is per route: the Pub/Sub OIDC JWT for Gmail pushes and the HMAC channel token for
 * Calendar notifications (SECURITY_AND_PRIVACY_PLAN CTL-3.7). The routes are registered by the sync
 * tasks; unknown paths answer `NOT_FOUND`.
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
  fn: 'webhooks-google',
  logger: createLogger({ fn: 'webhooks-google' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
  rejectBrowserOrigin: true,
  maxBodyBytes: 64 * 1024,
});

Deno.serve(app.fetch);
