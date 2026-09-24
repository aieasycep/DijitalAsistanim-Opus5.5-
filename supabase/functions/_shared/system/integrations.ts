/**
 * Production wiring of the integration runtime (INTEGRATION_PLAN §3; T-4.01…T-4.13) for `api`,
 * `oauth`, `worker`, `webhooks-google` and `webhooks-microsoft`: the supabase-backed store, the
 * provider registry, the token keyring, per-account provider quota, the job queue with worker pokes,
 * and the audit writer. The database client passed in is the function's system client.
 */
import { loadKeyring, type TokenKeyring } from '../crypto/token-cipher.ts';
import type { DbClient } from '../db/clients.ts';
import type { FunctionEnv, RawEnv } from '../env.ts';
import { enqueueJob, pokeWorker } from '../jobs/client.ts';
import type { Logger } from '../logging/logger.ts';
import { supabaseQuotaGate } from '../providers/http.ts';
import { supabaseAuditWriter } from '../services/audit.ts';
import { integrationProviders } from '../services/integrations/providers.ts';
import { integrationConfig, type IntegrationRuntime } from '../services/integrations/runtime.ts';
import { supabaseIntegrationStore } from '../services/integrations/store.ts';
import { supabaseWebhookLedger, type WebhookLedger } from '../webhooks/ledger.ts';

export interface IntegrationWiring {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
}

export function createIntegrationWiring(input: {
  readonly env: FunctionEnv;
  readonly raw: RawEnv;
  readonly system: DbClient;
  readonly log: Logger;
  readonly keyring?: () => Promise<TokenKeyring>;
  readonly fetch?: typeof fetch;
}): IntegrationWiring {
  const { env, raw, system, log } = input;
  const store = supabaseIntegrationStore(system);
  const config = integrationConfig(raw);
  let keyring: Promise<TokenKeyring> | null = null;
  const runtime: IntegrationRuntime = {
    store,
    providers: integrationProviders({
      raw,
      config,
      store,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    }),
    keyring: input.keyring ?? (() => (keyring ??= loadKeyring(env))),
    quotaFor: (accountId) => supabaseQuotaGate(system, accountId),
    enqueue: (job) => enqueueJob(system, job),
    poke: async (reason) => {
      await pokeWorker({
        baseUrl: env.SUPABASE_URL,
        secret: env.CRON_SECRET,
        reason,
        log,
        ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      });
    },
    audit: supabaseAuditWriter(system),
    log,
    config,
    now: () => new Date(),
  };
  return { runtime, webhooks: supabaseWebhookLedger(system) };
}
