/**
 * `webhooks-revenuecat` Edge Function entrypoint (`verify_jwt = false`; API_CONTRACTS §10 WH-05).
 * Authenticity: `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>` compared in constant time
 * (SECURITY_AND_PRIVACY_PLAN CTL-3.7); the route lives in `app.ts`.
 */
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { pokeWorker } from '../_shared/jobs/client.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { supabaseBillingLedger } from '../_shared/services/billing/repo.ts';
import { createRevenueCatWebhookApp } from './app.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const log = createLogger({ fn: 'webhooks-revenuecat' });
const app = createRevenueCatWebhookApp({
  authSecret: env.REVENUECAT_WEBHOOK_AUTH,
  ledger: supabaseBillingLedger(serviceClient(clientConfigFromEnv(raw))),
  poke: () =>
    pokeWorker({ baseUrl: env.SUPABASE_URL, secret: env.CRON_SECRET, reason: 'revenuecat', log }),
  log,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
