/**
 * `webhooks-google` Edge Function entrypoint (`verify_jwt = false`; API_CONTRACTS §10 WH-01/WH-02).
 * Authenticity is per route: the Pub/Sub OIDC JWT for Gmail pushes and the HMAC channel token for
 * Calendar notifications (SECURITY_AND_PRIVACY_PLAN CTL-3.7). Without the Pub/Sub or calendar
 * webhook configuration the matching route rejects every request and the accounts are polled.
 */
import { createRemoteJWKSet } from 'jose';
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { credentialStatus, loadEnv, processEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { googleEndpoints } from '../_shared/providers/google/config.ts';
import { createIntegrationWiring } from '../_shared/system/integrations.ts';
import { createGoogleWebhookApp } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const log = createLogger({ fn: 'webhooks-google' });
const wiring = createIntegrationWiring({
  env,
  raw,
  system: serviceClient(clientConfigFromEnv(raw)),
  log,
});
const pubsubReady = credentialStatus('google_pubsub', raw).status === 'configured';
const calendarReady = credentialStatus('google_calendar_webhook', raw).status === 'configured';
const app = createGoogleWebhookApp({
  runtime: wiring.runtime,
  webhooks: wiring.webhooks,
  pubsub: pubsubReady
    ? {
        jwks: createRemoteJWKSet(new URL(googleEndpoints(raw).certs), { cacheMaxAge: 3_600_000 }),
        audience: raw.GOOGLE_PUBSUB_PUSH_AUDIENCE ?? '',
        serviceAccount: raw.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT ?? '',
      }
    : null,
  calendarSecret: calendarReady ? (raw.WEBHOOK_HMAC_SECRET ?? null) : null,
  pepper: env.HASH_PEPPER,
  log,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
