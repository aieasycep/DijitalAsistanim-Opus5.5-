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
import { createProviderRegistry } from '../_shared/providers/registry.ts';
import { SERVER_ADAPTER_FACTORIES } from '../_shared/providers/factories.ts';
import { supabaseExecuteRepo } from '../_shared/services/approvals/execute/repo.ts';
import { registryProviderSessions } from '../_shared/services/approvals/execute/session.ts';
import { expoPushClientFromEnv } from '../_shared/services/notifications/expo-push.ts';
import {
  supabaseNotificationsRepo,
  supabaseTriggerRepo,
} from '../_shared/services/notifications/repo.ts';

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
    notifications: {
      repo: supabaseNotificationsRepo(system),
      triggers: supabaseTriggerRepo(system),
      expo: expoPushClientFromEnv(raw),
    },
    approvals: {
      repo: supabaseExecuteRepo(system),
      sessions: registryProviderSessions({
        system,
        registry: createProviderRegistry(SERVER_ADAPTER_FACTORIES, raw),
        keyring: () => (keyring ??= loadKeyring(env)),
      }),
      markers: { mailDomain: env.MAIL_MESSAGE_ID_DOMAIN, webUrl: env.PUBLIC_WEB_URL },
    },
  }),
  log: createLogger({ fn: 'worker' }),
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
