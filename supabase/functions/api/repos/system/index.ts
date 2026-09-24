/**
 * Production wiring of the `api` dependencies. This is the only place in `api/` allowed to create
 * the service client (SECURITY_AND_PRIVACY_PLAN CTL-3.6, enforced by `pnpm functions:lint`); every
 * system repository receives the verified user id from the request, never from the body.
 */
import { createRemoteJWKSet } from 'jose';
import {
  chainVerifiers,
  jwksVerifier,
  supabaseClaimsVerifier,
} from '../../../_shared/auth/user.ts';
import { loadKeyring, type TokenKeyring } from '../../../_shared/crypto/token-cipher.ts';
import {
  type ClientConfig,
  publicClient,
  serviceClient,
  userClient,
} from '../../../_shared/db/clients.ts';
import { DB_FN, rpc } from '../../../_shared/db/functions.ts';
import { credentialStatus, type FunctionEnv, type RawEnv } from '../../../_shared/env.ts';
import { supabaseIdempotencyRepo } from '../../../_shared/idempotency.ts';
import type { Logger } from '../../../_shared/logging/logger.ts';
import type { Sentry } from '../../../_shared/observability/sentry.ts';
import { supabaseRateLimitStore } from '../../../_shared/ratelimit.ts';
import { createAiProviders } from '../../../_shared/ai/providers/index.ts';
import {
  supabaseAccountStateRepo,
  supabaseAppSettingsRepo,
} from '../../../_shared/services/account-state.ts';
import { supabaseAuditWriter } from '../../../_shared/services/audit.ts';
import { supabaseBootstrapSources } from '../../../_shared/services/bootstrap.ts';
import { supabaseCredentialsRepo } from '../../../_shared/services/credentials.ts';
import { supabaseDevicesRepo } from '../../../_shared/services/devices.ts';
import { supabaseEntitlementReader } from '../../../_shared/services/entitlements.ts';
import { supabaseEntitlementGate } from '../../../_shared/services/entitlements/gate.ts';
import { supabaseBillingRepo } from '../../../_shared/services/billing/repo.ts';
import {
  createRevenueCatClient,
  revenueCatConfig,
} from '../../../_shared/services/billing/revenuecat.ts';
import { supabaseReferralRepo } from '../../../_shared/services/referrals/repo.ts';
import { supabaseFlagSource } from '../../../_shared/services/flags.ts';
import { createIntegrationWiring } from '../../../_shared/system/integrations.ts';
import type { ApiDeps } from '../../deps.ts';
import { supabaseAnalyticsRepo } from '../../routes/analytics.ts';
import { supabaseSupportRepo } from '../../routes/support.ts';
import { enqueueJob } from '../../../_shared/jobs/client.ts';
import { supabaseApprovalsRepo } from '../../../_shared/services/approvals/repo.ts';
import { supabaseExecuteRepo } from '../../../_shared/services/approvals/execute/repo.ts';
import { registryProviderSessions } from '../../../_shared/services/approvals/execute/session.ts';
import { providerEventPrecondition } from '../../../_shared/services/approvals/precondition.ts';
import { supabaseNotificationsRepo } from '../../../_shared/services/notifications/repo.ts';
import { supabaseRemindersRepo } from '../../../_shared/services/reminders.ts';
import { supabaseWidgetSources } from '../../../_shared/services/widgets/sources.ts';
import type { JobQueue } from '../../deps.ts';
import { supabaseIntelApi } from '../../routes/intel-api.ts';
import { createAiServices } from '../../../_shared/services/ai/runtime.ts';
import {
  supabaseMailStore,
  supabaseMemoryStore,
} from '../../../_shared/services/intel/supabase-store.ts';

export function createApiDeps(input: {
  readonly env: FunctionEnv;
  readonly raw: RawEnv;
  readonly config: ClientConfig;
  readonly log: Logger;
  readonly sentry: Sentry;
}): ApiDeps {
  const { env, raw, config } = input;
  const system = serviceClient(config);
  const settings = supabaseAppSettingsRepo(system);
  const flags = supabaseFlagSource(system);
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const verifier = chainVerifiers(
    supabaseClaimsVerifier(publicClient(config)),
    jwksVerifier({
      jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
        timeoutDuration: 3_000,
      }),
      issuer: `${base}/auth/v1`,
    }),
  );
  let keyring: Promise<TokenKeyring> | null = null;
  const ai = createAiProviders(raw);
  const approvals = supabaseApprovalsRepo(system);
  const reminders = supabaseRemindersRepo(system);
  const notifications = supabaseNotificationsRepo(system);
  const jobs: JobQueue = {
    enqueue: (job) => enqueueJob(system, job),
    async byKey(key) {
      const { data, error } = await system
        .from('jobs')
        .select('id,status')
        .eq('idempotency_key', key)
        .maybeSingle();
      if (error !== null) return null;
      return (data ?? null) as { id: string; status: string } | null;
    },
  };
  const integrations = createIntegrationWiring({
    env,
    raw,
    system,
    log: input.log,
    keyring: () => (keyring ??= loadKeyring(env)),
  });
  // Approval writes and precondition reads use the same adapters as sync (Google, Microsoft, demo).
  const eventPrecondition = providerEventPrecondition({
    sessions: registryProviderSessions({
      system,
      registry: integrations.runtime.providers,
      keyring: () => (keyring ??= loadKeyring(env)),
    }),
    accounts: supabaseExecuteRepo(system),
    log: input.log,
  });
  const gate = supabaseEntitlementGate(system);
  const revenueCat = revenueCatConfig(env);

  return {
    env,
    raw,
    log: input.log,
    sentry: input.sentry,
    verifier,
    accounts: supabaseAccountStateRepo(system),
    settings,
    rateLimits: supabaseRateLimitStore(system),
    idempotency: supabaseIdempotencyRepo(system),
    credentials: supabaseCredentialsRepo(system),
    audit: supabaseAuditWriter(system),
    appleSub: (userId) => rpc<string | null>(system, DB_FN.userAppleSub, { p_user: userId }),
    keyring: () => (keyring ??= loadKeyring(env)),
    integrations: integrations.runtime,
    capabilities: {
      aiGenerate: ai.available('anthropic') || ai.available('openai'),
      embeddings: ai.available('voyage'),
      ttsPremium: credentialStatus('tts_premium', raw).status === 'configured' || ai.fixtureMode,
      googleOauth: credentialStatus('google_oauth', raw).status === 'configured',
      microsoftOauth: credentialStatus('microsoft_oauth', raw).status === 'configured',
      purchases: credentialStatus('revenuecat', raw).status === 'configured',
      push: credentialStatus('expo_push', raw).status === 'configured',
    },
    business: {
      gate: () => gate,
      referrals: supabaseReferralRepo(system),
      billing: supabaseBillingRepo(system),
      revenueCat: revenueCat === null ? null : createRevenueCatClient({ config: revenueCat }),
    },
    repos: (auth) => {
      const user = userClient(auth.jwt, config);
      const entitlements = supabaseEntitlementReader(user);
      return {
        devices: supabaseDevicesRepo({ system, user }),
        entitlements,
        bootstrap: supabaseBootstrapSources(
          { user, system },
          {
            entitlements,
            flags: (userId, platform, version) => flags.forUser(userId, platform, version),
            minSupportedVersion: () => settings.minSupportedVersion(),
            referralRewardDays: () => settings.referralRewardDays(),
          },
        ),
        analytics: supabaseAnalyticsRepo({ system, user }),
        support: supabaseSupportRepo(system),
        approvals,
        reminders,
        notifications,
        widgets: supabaseWidgetSources(user, auth.userId),
        jobs,
        eventPrecondition,
      };
    },
    intel: supabaseIntelApi({
      system,
      config,
      ai: createAiServices(system, raw, input.log),
      mail: supabaseMailStore(system),
      memory: supabaseMemoryStore(system),
      bodies: null,
    }),
  };
}
