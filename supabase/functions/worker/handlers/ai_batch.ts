/**
 * JOB-28 `ai_batch` (AI_PIPELINE_PLAN §8.8; T-5.08 weekly review): Message Batches for the weekly
 * narrative. `submit` builds the requests from the item jobs (the weekly briefing jobs), reserves
 * the budget per item and records `ai_batches`; `collect` re-queues itself every 5 minutes until
 * the batch has ended (or falls back to the synchronous route after 17:30 local / 24 h), applies
 * each result exactly once and settles the budget; `purge` deletes the provider-side results.
 */
import { AI_FEATURE_VALUES, atLocalTime } from '@da/domain';
import { Uuid, WeeklyReviewV1 } from '@da/validation';
import { z } from 'zod';
import { assemblePrompt } from '../../_shared/ai/prompts/assemble.ts';
import type { AnthropicBatches } from '../../_shared/ai/providers/anthropic.ts';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import {
  batchRoute,
  collectBatch,
  settleBatchItem,
  submitBatch,
} from '../../_shared/services/ai/batch.ts';
import type { PipelineContext } from '../../_shared/services/ai/pipeline.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import {
  composeWeekly,
  weeklyComposition,
  type WeeklyInput,
  weeklyNarrative,
  weekPeriod,
  weeklyPrompt,
} from '../../_shared/services/briefings/weekly.ts';
import type { BriefingRow } from '../../_shared/services/intel/types.ts';
import { addDaysToLocalDate, endOfLocalDay, startOfLocalDay } from '@da/domain';
import { applyComposed, WEEKLY_SYNC_FALLBACK } from './briefing.ts';
import { type IntelDeps, pipelineFor } from './intel.ts';

export const AiBatchPayload = z.object({
  phase: z.enum(['submit', 'collect', 'purge']),
  feature: z.enum(AI_FEATURE_VALUES),
  batch_ref: z.string().max(128).nullable(),
  item_job_ids: z.array(Uuid).max(500),
});
export type AiBatchPayload = z.infer<typeof AiBatchPayload>;

const POLL_MS = 5 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;

interface WeeklyContext {
  readonly briefing: BriefingRow;
  readonly user: AiUser;
  readonly pipeline: PipelineContext;
  readonly input: WeeklyInput;
}

async function weeklyContext(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
  briefing: BriefingRow,
): Promise<WeeklyContext> {
  const user = await deps.ai.users.load(briefing.user_id);
  const tz = briefing.time_zone || user.timeZone;
  const period = weekPeriod(briefing.local_date);
  const nextStart = addDaysToLocalDate(period.end, 1);
  const [counts, nextWeek, snapshot] = await Promise.all([
    deps.stats.weekly(
      user.userId,
      startOfLocalDay(period.start, tz),
      endOfLocalDay(period.end, tz),
      tz,
    ),
    deps.mail.events(
      user.userId,
      startOfLocalDay(nextStart, tz),
      endOfLocalDay(addDaysToLocalDate(nextStart, 6), tz),
    ),
    deps.insights.snapshot(user.userId, ctx.now()),
  ]);
  return {
    briefing,
    user,
    pipeline: pipelineFor(deps, user, ctx),
    input: { briefing, now: ctx.now(), counts, insights: snapshot.insights, nextWeek },
  };
}

async function syncFallback(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
  w: WeeklyContext,
): Promise<void> {
  const composed = await composeWeekly(w.pipeline, w.input);
  await applyComposed(deps, ctx, w.briefing, composed, Date.now());
}

async function pendingBriefings(
  deps: IntelDeps,
  jobIds: readonly string[],
): Promise<BriefingRow[]> {
  return (await deps.briefings.byJobIds(jobIds)).filter(
    (b) => b.kind === 'weekly' && b.status === 'generating',
  );
}

function batchInfo(b: BriefingRow): {
  ref?: string;
  reservation_id?: string | null;
  prompt_version_id?: string | null;
  submitted_at?: string;
} {
  const batch = (b.provenance?.batch ?? {}) as Record<string, unknown>;
  return {
    ...(typeof batch.ref === 'string' ? { ref: batch.ref } : {}),
    reservation_id: typeof batch.reservation_id === 'string' ? batch.reservation_id : null,
    prompt_version_id: typeof batch.prompt_version_id === 'string' ? batch.prompt_version_id : null,
    ...(typeof batch.submitted_at === 'string' ? { submitted_at: batch.submitted_at } : {}),
  };
}

async function submit(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
): Promise<Record<string, string | number>> {
  const briefings = await pendingBriefings(deps, ctx.payload.item_job_ids);
  let submitted = 0;
  let fallback = 0;
  for (const b of briefings) {
    const w = await weeklyContext(deps, ctx, b);
    const route = await batchRoute(deps.ai.runtime, {
      feature: 'weekly_review',
      profile: w.user.profile,
      flags: w.user.flags,
    });
    if (route === null) {
      await syncFallback(deps, ctx, w);
      fallback++;
      continue;
    }
    const prompt = weeklyPrompt(w.pipeline, w.input);
    const version = await deps.ai.runtime.prompts.active('weekly_review');
    const parts = assemblePrompt({
      version,
      context: prompt.context,
      docs: prompt.docs,
      ...(deps.ai.canary === undefined ? {} : { canary: deps.ai.canary }),
      cacheTtl: '1h',
    });
    const outcome = await submitBatch(deps.ai.runtime, route, [
      {
        customId: b.id,
        userId: w.user.userId,
        feature: 'weekly_review',
        schema: WeeklyReviewV1,
        schemaName: 'WeeklyReviewV1',
        prompt: parts,
        userRef: w.user.userRef,
        correlationId: ctx.correlationId,
        units: 1,
      },
    ]);
    if (outcome.kind !== 'submitted') {
      await syncFallback(deps, ctx, w);
      fallback++;
      continue;
    }
    await deps.briefings.recordBatch({
      batch_id: outcome.batchId,
      feature: 'weekly_review',
      request_count: 1,
      correlation_id: /^[0-9a-f-]{36}$/i.test(ctx.correlationId) ? ctx.correlationId : null,
    });
    await deps.briefings.update(b.id, {
      provenance: {
        narrative_mode: 'batch_pending',
        batch: {
          ref: outcome.batchId,
          reservation_id: outcome.reservations[b.id] ?? null,
          prompt_version_id: version.id,
          submitted_at: ctx.now().toISOString(),
        },
      },
    });
    await ctx.enqueue({
      type: 'ai_batch',
      idempotencyKey: `ai_batch:weekly_review:collect:${outcome.batchId}:${ctx.now().toISOString().slice(0, 16)}`,
      payload: {
        phase: 'collect',
        feature: 'weekly_review',
        batch_ref: outcome.batchId,
        item_job_ids: ctx.payload.item_job_ids,
      },
      runAfter: new Date(ctx.now().getTime() + POLL_MS),
    });
    submitted++;
  }
  return { submitted, fallback };
}

async function collect(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
): Promise<Record<string, string | number>> {
  const ref = ctx.payload.batch_ref;
  if (ref === null) throw new JobError('BATCH_REF_REQUIRED', false);
  const briefings = (await pendingBriefings(deps, ctx.payload.item_job_ids)).filter(
    (b) => batchInfo(b).ref === ref,
  );
  if (briefings.length === 0) return { applied: 0, state: 'nothing_pending' };
  const contexts = new Map<string, WeeklyContext>();
  for (const b of briefings) contexts.set(b.id, await weeklyContext(deps, ctx, b));
  const first = contexts.get(briefings[0]!.id)!;
  const route = await batchRoute(deps.ai.runtime, {
    feature: 'weekly_review',
    profile: first.user.profile,
    flags: { ...first.user.flags, 'ai.batch.enabled': true },
  });
  const now = ctx.now();
  const expired = briefings.every((b) => {
    const info = batchInfo(b);
    const tooOld =
      info.submitted_at !== undefined && now.getTime() - Date.parse(info.submitted_at) > MAX_AGE_MS;
    return (
      tooOld ||
      now.getTime() >= atLocalTime(b.local_date, WEEKLY_SYNC_FALLBACK, b.time_zone).getTime()
    );
  });
  const prompts = new Map([...contexts].map(([id, w]) => [id, weeklyPrompt(w.pipeline, w.input)]));
  const polled =
    route === null
      ? { state: 'in_progress' as const, results: [] }
      : await collectBatch(route, ref, WeeklyReviewV1, (customId) => {
          const p = prompts.get(customId);
          return {
            sources: p === undefined ? [] : [...p.docs.map((d) => d.text), ...p.context],
            aliases: new Set(p?.docs.map((d) => d.ref) ?? []),
            ...(deps.ai.canary === undefined ? {} : { canary: deps.ai.canary }),
          };
        });
  if (polled.state !== 'ended') {
    if (!expired && route !== null) {
      await ctx.enqueue({
        type: 'ai_batch',
        idempotencyKey: `ai_batch:weekly_review:collect:${ref}:${now.toISOString().slice(0, 16)}`,
        payload: { ...ctx.payload },
        runAfter: new Date(now.getTime() + POLL_MS),
      });
      return { applied: 0, state: polled.state };
    }
    for (const w of contexts.values()) await syncFallback(deps, ctx, w);
    await deps.briefings.updateBatch(ref, { status: 'expired' });
    await enqueuePurge(ctx, ref);
    return { applied: 0, state: 'expired_fallback', fallback: contexts.size };
  }
  let applied = 0;
  for (const r of polled.results) {
    const w = contexts.get(r.customId);
    const prompt = prompts.get(r.customId);
    if (w === undefined || prompt === undefined) continue;
    const info = batchInfo(w.briefing);
    await settleBatchItem(deps.ai.runtime, {
      route: route!,
      batchId: ref,
      userId: w.user.userId,
      plan: w.user.plan,
      profile: w.user.profile,
      feature: 'weekly_review',
      promptVersionId: info.prompt_version_id ?? null,
      schemaName: 'WeeklyReviewV1',
      reservationId: info.reservation_id ?? null,
      usage: r.usage,
      ok: r.data !== null,
      error: r.error,
      units: 1,
      correlationId: ctx.correlationId,
      jobId: ctx.job.id,
    });
    const narrative = weeklyNarrative(r.data, prompt, w.user.locale);
    const composed = weeklyComposition(
      w.pipeline,
      w.input,
      prompt,
      narrative,
      narrative.mode === 'ai' ? (info.prompt_version_id ?? null) : null,
    );
    await applyComposed(deps, ctx, w.briefing, composed, Date.now());
    contexts.delete(r.customId);
    applied++;
  }
  for (const w of contexts.values()) await syncFallback(deps, ctx, w);
  await deps.briefings.updateBatch(ref, {
    status: 'collected',
    ended_at: now.toISOString(),
    collected_at: now.toISOString(),
  });
  await enqueuePurge(ctx, ref);
  return { applied, state: 'ended' };
}

function enqueuePurge(ctx: JobContext<AiBatchPayload>, ref: string): Promise<string> {
  return ctx.enqueue({
    type: 'ai_batch',
    idempotencyKey: `ai_batch:weekly_review:purge:${ref}`,
    payload: { phase: 'purge', feature: 'weekly_review', batch_ref: ref, item_job_ids: [] },
  });
}

async function purge(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
): Promise<Record<string, string>> {
  const ref = ctx.payload.batch_ref;
  if (ref === null) throw new JobError('BATCH_REF_REQUIRED', false);
  const provider = deps.ai.runtime.provider('anthropic') as { batches?: AnthropicBatches } | null;
  if (provider?.batches === undefined) throw new JobError('BATCH_PROVIDER_UNAVAILABLE', true, 3600);
  await provider.batches.purge(ref);
  await deps.briefings.updateBatch(ref, { status: 'purged', purged_at: ctx.now().toISOString() });
  return { purged: ref };
}

export async function runAiBatch(
  deps: IntelDeps,
  ctx: JobContext<AiBatchPayload>,
): Promise<Record<string, string | number>> {
  if (ctx.payload.feature !== 'weekly_review') {
    throw new JobError('BATCH_FEATURE_UNSUPPORTED', false);
  }
  switch (ctx.payload.phase) {
    case 'submit':
      return await submit(deps, ctx);
    case 'collect':
      return await collect(deps, ctx);
    case 'purge':
      return await purge(deps, ctx);
  }
}

export function aiBatchJob(deps: IntelDeps) {
  return defineJob({
    type: 'ai_batch',
    payload: AiBatchPayload,
    handler: async (ctx) => ({ ...(await runAiBatch(deps, ctx)) }),
  });
}
