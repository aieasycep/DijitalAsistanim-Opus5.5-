/** The probe set run by `POST /health/run` (API_CONTRACTS §14 HLT-02). */
import { aiProbes } from './ai.ts';
import { apiProbe } from './api.ts';
import { auditChainProbe } from './audit_chain.ts';
import { authProbe } from './auth.ts';
import { cronProbe } from './cron.ts';
import { databaseProbe } from './database.ts';
import { emailDeliveryProbe } from './email_delivery.ts';
import { gmailProbe } from './gmail.ts';
import { googleOauthProbe } from './google_oauth.ts';
import { graphProbe } from './graph.ts';
import { microsoftOauthProbe } from './microsoft_oauth.ts';
import { pushProbe } from './push.ts';
import { revenuecatProbe } from './revenuecat.ts';
import { storageProbe } from './storage.ts';
import type { Probe, ProbeResult } from './types.ts';
import { webhooksProbe } from './webhooks.ts';

/** Keyed by the probe name the caller may select (`HealthProbe`); `ai` yields three components. */
export const PROBES: Readonly<
  Record<string, { probe: Probe; components: readonly ProbeResult['component'][] }>
> = {
  api: { probe: apiProbe, components: ['api'] },
  database: { probe: databaseProbe, components: ['database'] },
  supabase_auth: { probe: authProbe, components: ['supabase_auth'] },
  storage: { probe: storageProbe, components: ['storage'] },
  google_oauth: { probe: googleOauthProbe, components: ['google_oauth'] },
  microsoft_oauth: { probe: microsoftOauthProbe, components: ['microsoft_oauth'] },
  gmail: { probe: gmailProbe, components: ['gmail'] },
  microsoft_graph: { probe: graphProbe, components: ['microsoft_graph'] },
  push: { probe: pushProbe, components: ['push'] },
  ai: { probe: aiProbes, components: ['ai_anthropic', 'ai_openai', 'ai_voyage'] },
  revenuecat: { probe: revenuecatProbe, components: ['revenuecat'] },
  cron: { probe: cronProbe, components: ['cron'] },
  webhooks: { probe: webhooksProbe, components: ['webhooks'] },
  email_delivery: { probe: emailDeliveryProbe, components: ['email_delivery'] },
  audit_chain: { probe: auditChainProbe, components: ['audit_chain'] },
};

/** Components `system_health_checks.component` accepts today (migration 0010 check). */
export const PERSISTED_COMPONENTS: ReadonlySet<string> = new Set([
  'api',
  'database',
  'supabase_auth',
  'storage',
  'google_oauth',
  'microsoft_oauth',
  'gmail',
  'microsoft_graph',
  'push',
  'ai_anthropic',
  'ai_openai',
  'ai_voyage',
  'revenuecat',
  'cron',
  'webhooks',
  'worker',
]);
