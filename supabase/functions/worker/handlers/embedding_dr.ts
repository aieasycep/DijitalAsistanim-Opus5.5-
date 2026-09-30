/**
 * JOB-16 `embedding {mode:'reembed'}`: the disaster-recovery re-embed (AI_PIPELINE_PLAN §10.8
 * steps 2 and 6, ADR-45). A scoped definition of the `embedding` job type: turning
 * `ai.embedding_dr.reembed` on (backoffice Settings, audited) queues the first batch through the
 * migration 20260924003300 trigger; each batch embeds up to {@link DR_BATCH} chunks that have a
 * primary embedding and no DR vector through the configured DR target (OpenAI, 1024-d), writes
 * `memory_chunks.embedding_dr` and queues the next batch after {@link DR_PACE_MS} (rate limit).
 *
 * - Turning `reembed` off stops the chain at the next batch (`skipped: 'disabled'`).
 * - Data Source Controls: a chunk whose owner turned its class off is skipped (never sent).
 * - System call: no user budget; every attempt writes an `ai_requests` row (user null, cost from the
 *   price book); the global kill switches apply.
 * - A retryable provider failure retries the batch; a non-retryable one (no key, kill switch) ends
 *   the chain as `degraded` until the setting is turned on again.
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import { chunkAllowed, DEFAULT_AI_DATA_ACCESS } from '../../_shared/policy/data-access.ts';
import type { EmbeddingDrStore } from '../../_shared/services/memory/dr.ts';
import { embedTexts } from '../../_shared/services/memory/embed.ts';
import type { IntelDeps } from './intel.ts';

export const DR_BATCH = 128;
export const DR_PACE_MS = 2_000;

export const EmbeddingDrPayload = z.object({
  mode: z.literal('reembed'),
  after_id: Uuid.nullable().optional(),
});
export type EmbeddingDrPayload = z.infer<typeof EmbeddingDrPayload>;

export async function runEmbeddingDr(
  deps: IntelDeps & { readonly dr: EmbeddingDrStore },
  ctx: JobContext<EmbeddingDrPayload>,
): Promise<Record<string, number | string | boolean>> {
  const config = await deps.dr.get();
  if (config === null || !config.reembed) return { skipped: 'disabled' };
  const rows = await deps.dr.pending(ctx.payload.after_id ?? null, DR_BATCH);
  if (rows.length === 0) return { done: true, embedded: 0 };
  const access = await deps.dr.access([...new Set(rows.map((r) => r.user_id))]);
  const allowed = rows.filter((r) =>
    chunkAllowed(access.get(r.user_id) ?? DEFAULT_AI_DATA_ACCESS, r),
  );
  let embedded = 0;
  if (allowed.length > 0) {
    const outcome = await embedTexts(deps.ai.runtime, {
      feature: 'embedding_doc',
      userId: null,
      plan: null,
      profile: 'balanced',
      flags: await deps.dr.flags(),
      inputs: allowed.map((r) => r.content),
      correlationId: ctx.correlationId,
      jobId: ctx.job.id,
      signal: ctx.signal,
      target: config.target,
    });
    if (outcome.kind === 'unavailable') {
      if (outcome.retryable && ctx.job.attempts < ctx.job.max_attempts) {
        throw new JobError('EMBEDDING_PROVIDER_UNAVAILABLE', true);
      }
      ctx.log.warn('embedding_dr_degraded', { reason: outcome.reason });
      return { degraded: true, reason: outcome.reason, embedded: 0 };
    }
    await deps.dr.write(
      allowed.flatMap((r, i) => {
        const v = outcome.vectors[i];
        return v === undefined ? [] : [{ id: r.id, embedding: v }];
      }),
    );
    embedded = allowed.length;
  }
  const last = rows[rows.length - 1]!.id;
  const more = rows.length === DR_BATCH;
  if (more) {
    await ctx.enqueue({
      type: 'embedding',
      idempotencyKey: `embedding:dr:after:${last}`,
      payload: { mode: 'reembed', after_id: last },
      runAfter: new Date(ctx.now().getTime() + DR_PACE_MS),
      priority: 150,
    });
  }
  return { embedded, withheld: rows.length - allowed.length, done: !more, after_id: last };
}

/** Scoped `embedding` definition: claims only `{mode:'reembed'}` payloads. */
export function embeddingDrJob(deps: IntelDeps & { readonly dr: EmbeddingDrStore }) {
  return defineJob({
    type: 'embedding',
    payload: EmbeddingDrPayload,
    match: (payload) => (payload as { mode?: unknown } | null)?.mode === 'reembed',
    handler: async (ctx) => ({ ...(await runEmbeddingDr(deps, ctx)) }),
  });
}
