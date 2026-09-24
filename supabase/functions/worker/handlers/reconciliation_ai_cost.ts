/**
 * `reconciliation` with `payload.scope='ai_cost'` (IMPLEMENTATION_PLAN T-5.17; AI_PIPELINE_PLAN
 * §8.12): the nightly comparison of our recorded AI spend with the Anthropic cost report and the
 * OpenAI costs API for the previous UTC day. It is a scoped definition of the `reconciliation`
 * job type (the account-level reconciliation of JOB-08 keeps its own handler); `private.
 * release_expired_budget_holds` enqueues it from 03:30 UTC once per day.
 */
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobContext } from '../../_shared/jobs/types.ts';
import { anthropicBill, openaiBill, reconciliationRows } from '../../_shared/services/ai/reconcile.ts';
import type { IntelDeps } from './intel.ts';

export const AiCostReconciliationPayload = z.object({
  scope: z.literal('ai_cost'),
  utc_date: z.iso.date(),
});
export type AiCostReconciliationPayload = z.infer<typeof AiCostReconciliationPayload>;

export async function runAiCostReconciliation(
  deps: IntelDeps,
  ctx: JobContext<AiCostReconciliationPayload>,
): Promise<Record<string, string | number>> {
  const { env, fetch: fetcher, audit } = deps.reconciliation;
  const day = ctx.payload.utc_date;
  const [ours, anthropic, openai] = await Promise.all([
    deps.reconciliation.costByModel(day),
    anthropicBill(fetcher, env, day, ctx.signal),
    openaiBill(fetcher, env, day, ctx.signal),
  ]);
  const rows = reconciliationRows(day, ours, [anthropic, openai]);
  await deps.reconciliation.recordHealth(rows);
  const degraded = rows.filter((r) => r.status === 'degraded');
  for (const r of degraded) {
    await audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.ai_ops.cost_drift',
      targetType: 'system_health',
      targetId: r.component,
      targetUserId: null,
      result: 'success',
      details: r.detail,
      correlationId: ctx.correlationId,
    });
  }
  return {
    utc_date: day,
    degraded: degraded.length,
    anthropic: anthropic.status,
    openai: openai.status,
  };
}

export function aiCostReconciliationJob(deps: IntelDeps) {
  return defineJob({
    type: 'reconciliation',
    payload: AiCostReconciliationPayload,
    handler: async (ctx) => ({ ...(await runAiCostReconciliation(deps, ctx)) }),
    match: (payload) =>
      typeof payload === 'object' && payload !== null && (payload as { scope?: unknown }).scope === 'ai_cost',
  });
}
