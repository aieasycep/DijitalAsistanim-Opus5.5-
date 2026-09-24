/** `worker` Edge Function entrypoint (`verify_jwt = false`; automations secret checked in code). */
import { loadKeyring, type TokenKeyring } from '../_shared/crypto/token-cipher.ts';
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { supabaseJobsRepo } from '../_shared/jobs/client.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { supabaseCredentialsRepo } from '../_shared/services/credentials.ts';
import { createWorkerApp } from './app.ts';
import { createHandlerRegistry } from './handlers/index.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const system = serviceClient(clientConfigFromEnv(raw));
let keyring: Promise<TokenKeyring> | null = null;
const app = createWorkerApp({
  secret: env.CRON_SECRET,
  repo: supabaseJobsRepo(system),
  registry: createHandlerRegistry({
    credentials: supabaseCredentialsRepo(system),
    keyring: () => (keyring ??= loadKeyring(env)),
  }),
  log: createLogger({ fn: 'worker' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
