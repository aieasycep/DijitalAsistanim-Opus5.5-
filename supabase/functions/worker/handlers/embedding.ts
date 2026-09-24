/**
 * JOB-16 `embedding` (IMPLEMENTATION_PLAN T-5.07; API_CONTRACTS §11; Pro only): derived-fact chunks
 * with provenance and the source's `expires_at` are upserted (content hash, existing chunks
 * skipped), then embedded through the `embedding_doc` route (1024-d documents). With no provider,
 * a kill switch or a non-retryable failure the chunks stay without a vector — FTS still finds them —
 * and the result says `degraded`; a retryable provider failure retries the job.
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { JobError, type JobContext } from '../../_shared/jobs/types.ts';
import { chunkRow } from '../../_shared/services/memory/chunk.ts';
import { embedTexts } from '../../_shared/services/memory/embed.ts';
import type { MemoryChunkInsert } from '../../_shared/services/intel/types.ts';
import type { IntelDeps } from './intel.ts';

export const EmbeddingPayload = z.object({
  user_id: Uuid,
  items: z
    .array(
      z.object({
        kind: z.enum([
          'email_summary',
          'life_event',
          'commitment',
          'capture',
          'meeting_note',
          'assistant_fact',
          'person_profile',
        ]),
        id: Uuid,
      }),
    )
    .min(1)
    .max(100),
});
export type EmbeddingPayload = z.infer<typeof EmbeddingPayload>;

export async function runEmbedding(
  deps: IntelDeps,
  ctx: JobContext<EmbeddingPayload>,
): Promise<Record<string, number | boolean | string>> {
  const userId = ctx.payload.user_id;
  const user = await deps.ai.users.load(userId);
  if (!user.isPro) return { skipped: 'not_entitled', chunks: 0, degraded: false };
  const sources = await deps.memory.sources(userId, ctx.payload.items);
  const rows = sources.map(chunkRow).filter((r): r is MemoryChunkInsert => r !== null);
  const inserted = await deps.memory.upsertChunks(rows);
  const pending = await deps.memory.pendingChunks(userId, null, 128);
  if (pending.length === 0) return { chunks: inserted.length, embedded: 0, degraded: false };
  const outcome = await embedTexts(deps.ai.runtime, {
    feature: 'embedding_doc',
    userId,
    plan: user.plan,
    profile: user.profile,
    flags: user.flags,
    inputs: pending.map((c) => c.content),
    correlationId: ctx.correlationId,
    jobId: ctx.job.id,
    signal: ctx.signal,
  });
  if (outcome.kind === 'unavailable') {
    if (outcome.retryable && ctx.job.attempts < ctx.job.max_attempts) {
      throw new JobError('EMBEDDING_PROVIDER_UNAVAILABLE', true);
    }
    ctx.log.warn('embedding_degraded', { reason: outcome.reason });
    return { chunks: inserted.length, embedded: 0, degraded: true, reason: outcome.reason };
  }
  await deps.memory.writeEmbeddings(
    pending.flatMap((c, i) => {
      const v = outcome.vectors[i];
      return v === undefined ? [] : [{ id: c.id, embedding: v, model: outcome.model }];
    }),
  );
  return { chunks: inserted.length, embedded: pending.length, degraded: false };
}

export function embeddingJob(deps: IntelDeps) {
  return defineJob({
    type: 'embedding',
    payload: EmbeddingPayload,
    handler: async (ctx) => ({ ...(await runEmbedding(deps, ctx)) }),
  });
}
