/** `worker` Edge Function entrypoint (`verify_jwt = false`; automations secret checked in code). */
import { loadKeyring, type TokenKeyring } from '../_shared/crypto/token-cipher.ts';
import { clientConfigFromEnv, serviceClient } from '../_shared/db/clients.ts';
import { loadEnv, processEnv } from '../_shared/env.ts';
import { supabaseJobsRepo } from '../_shared/jobs/client.ts';
import { createLogger } from '../_shared/logging/logger.ts';
import { createSentry } from '../_shared/observability/sentry.ts';
import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';
import { supabaseCredentialsRepo } from '../_shared/services/credentials.ts';
import { supabaseBillingRepo } from '../_shared/services/billing/repo.ts';
import {
  createRevenueCatClient,
  revenueCatConfig,
} from '../_shared/services/billing/revenuecat.ts';
import { supabaseReferralRepo } from '../_shared/services/referrals/repo.ts';
import { createIntegrationWiring } from '../_shared/system/integrations.ts';
import { createWorkerApp } from './app.ts';
import { createHandlerRegistry } from './handlers/index.ts';
import { supabaseExecuteRepo } from '../_shared/services/approvals/execute/repo.ts';
import { registryProviderSessions } from '../_shared/services/approvals/execute/session.ts';
import { expoPushClientFromEnv } from '../_shared/services/notifications/expo-push.ts';
import {
  supabaseNotificationsRepo,
  supabaseTriggerRepo,
} from '../_shared/services/notifications/repo.ts';
import { createIntelDeps } from './handlers/intel-wiring.ts';
import { integrationMailBodySource } from '../_shared/services/intel/mail-bodies.ts';
import { supabaseAssistStore } from '../_shared/services/assist/supabase-store.ts';
import { supabaseStorage } from '../_shared/services/storage.ts';

const raw = processEnv();
assertDemoAllowed(raw);
const env = loadEnv(raw);
const system = serviceClient(clientConfigFromEnv(raw));
let keyring: Promise<TokenKeyring> | null = null;
const revenueCat = revenueCatConfig(env);
const workerLog = createLogger({ fn: 'worker' });
const integrations = createIntegrationWiring({
  env,
  raw,
  system,
  log: workerLog,
  keyring: () => (keyring ??= loadKeyring(env)),
});
// Transient provider bodies for triage, analysis and reply drafts (A's registry + token source).
const intel = createIntelDeps(system, raw, workerLog, {
  bodies: integrationMailBodySource(integrations.runtime, workerLog),
});
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
        registry: integrations.runtime.providers,
        keyring: () => (keyring ??= loadKeyring(env)),
      }),
      markers: { mailDomain: env.MAIL_MESSAGE_ID_DOMAIN, webUrl: env.PUBLIC_WEB_URL },
    },
    business: {
      billing: {
        repo: supabaseBillingRepo(system),
        revenueCat: revenueCat === null ? null : createRevenueCatClient({ config: revenueCat }),
        production: env.APP_ENV === 'production',
      },
      referrals: { repo: supabaseReferralRepo(system), pepper: env },
    },
    integrations: { runtime: integrations.runtime, webhooks: integrations.webhooks },
    intel,
    assist: { intel, store: supabaseAssistStore(system), storage: supabaseStorage(system) },
    email: { system, raw, keyring: () => (keyring ??= loadKeyring(env)) },
  }),
  log: workerLog,
  sentry: createSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV }),
});

Deno.serve(app.fetch);
