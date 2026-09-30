/**
 * `webhooks-microsoft` Edge Function entrypoint (`verify_jwt = false`; API_CONTRACTS §10 WH-03/WH-04).
 * Authenticity is per notification: the `validationToken` echo and the hashed `clientState` compared
 * in constant time (SECURITY_AND_PRIVACY_PLAN CTL-3.7).
 */
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { createIntegrationWiring } from '../_shared/system/integrations.ts';
import { createMicrosoftWebhookApp } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const log = createLogger({ fn: 'webhooks-microsoft' });
const wiring = createIntegrationWiring({
  env,
  raw,
  system: serviceClient(clientConfigFromEnv(raw)),
  log,
});
const app = createMicrosoftWebhookApp({
  runtime: wiring.runtime,
  webhooks: wiring.webhooks,
  log,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
