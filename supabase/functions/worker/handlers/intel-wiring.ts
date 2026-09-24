/**
 * Production wiring of the AI pipeline handlers over the worker's service client. The transient
 * mail-body source stays `null` until the provider token context of the integrations (T-4.03 /
 * T-4.04) is available to the worker; triage then runs on headers, subject and snippet.
 */
import type { DbClient } from '../../_shared/db/clients.ts';
import { DB_FN, rpc } from '../../_shared/db/functions.ts';
import type { RawEnv } from '../../_shared/env.ts';
import { mapDbError } from '../../_shared/errors.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import type { OurCost } from '../../_shared/services/ai/reconcile.ts';
import { createAiServices } from '../../_shared/services/ai/runtime.ts';
import { supabaseAuditWriter } from '../../_shared/services/audit.ts';
import type { MailBodySource } from '../../_shared/services/intel/store.ts';
import {
  supabaseBriefingStore,
  supabaseInsightStore,
  supabaseMailStore,
  supabaseMemoryStore,
  supabaseStatsStore,
} from '../../_shared/services/intel/supabase-store.ts';
import type { IntelDeps } from './intel.ts';

export function createIntelDeps(
  system: DbClient,
  raw: RawEnv,
  log: Logger,
  options: { bodies?: MailBodySource | null; fetch?: typeof fetch } = {},
): IntelDeps {
  return {
    ai: createAiServices(system, raw, log),
    mail: supabaseMailStore(system),
    insights: supabaseInsightStore(system),
    briefings: supabaseBriefingStore(system),
    stats: supabaseStatsStore(system),
    memory: supabaseMemoryStore(system),
    bodies: options.bodies ?? null,
    reconciliation: {
      env: raw,
      fetch: options.fetch ?? fetch,
      costByModel: (day) => rpc<OurCost[]>(system, DB_FN.aiCostByModel, { p_day: day }),
      async recordHealth(rows) {
        if (rows.length === 0) return;
        const { error } = await system
          .from('system_health_checks')
          .insert(rows.map((r) => ({ ...r, checked_by: 'cron' })));
        if (error !== null) throw mapDbError(error);
      },
      audit: supabaseAuditWriter(system),
    },
  };
}
