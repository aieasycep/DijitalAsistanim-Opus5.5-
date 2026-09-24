/**
 * `webhooks-microsoft` Edge Function entrypoint (`verify_jwt = false`; API_CONTRACTS §10 WH-03/WH-04).
 * Authenticity is per notification: the `validationToken` echo and the hashed `clientState` compared
 * in constant time (SECURITY_AND_PRIVACY_PLAN CTL-3.7). The routes are registered by the sync tasks;
 * unknown paths answer `NOT_FOUND`.
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
  fn: 'webhooks-microsoft',
  logger: createLogger({ fn: 'webhooks-microsoft' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
  rejectBrowserOrigin: true,
  maxBodyBytes: 1024 * 1024,
});

Deno.serve(app.fetch);
