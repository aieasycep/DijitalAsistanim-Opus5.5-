/**
 * JOB-14 `briefing` (IMPLEMENTATION_PLAN T-5.08; API_CONTRACTS §11): morning (T2 narrative from the
 * ranked item JSON), midday (T0 delta, `skipped` on no meaningful delta), evening (T0 lists) and
 * weekly (stats + narrative, Message Batches when enabled). Status flow `scheduled → generating →
 * ready | skipped`, then a `notification` (B's pipeline) — none for a skipped midday. The last
 * failed attempt marks the row `failed` so API-BRF-04 can retry it.
 *
 * Payloads: the documented `{user_id, kind, local_date, origin}` and the scheduler's
 * `{briefing_id}` (scheduler_tick pre-creates the `scheduled` row).
 */
import {
  addDaysToLocalDate,
  atLocalTime,
  BRIEFING_KIND_VALUES,
  briefingKey,
  endOfLocalDay,
  localDate,
  localTime,
  startOfLocalDay,
} from '@da/domain';
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import { batchRoute } from '../../_shared/services/ai/batch.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import { composeEvening } from '../../_shared/services/briefings/evening.ts';
import { composeMidday } from '../../_shared/services/briefings/midday.ts';
import { type ComposedBriefing, composeMorning } from '../../_shared/services/briefings/morning.ts';
import { composeWeekly, weekPeriod, weeklyStats } from '../../_shared/services/briefings/weekly.ts';
import { isOn } from '../../_shared/services/flags.ts';
import type { BriefingRow } from '../../_shared/services/intel/types.ts';
import { enqueueNotification, type IntelDeps, pipelineFor } from './intel.ts';
import { enqueueBriefingAudio } from './briefing_audio.ts';

export const BriefingPayload = z.union([
  z.object({ briefing_id: Uuid }),
  z.object({
    user_id: Uuid,
    kind: z.enum(BRIEFING_KIND_VALUES),
    local_date: z.iso.date(),
    origin: z.enum(['schedule', 'first_analysis', 'manual_regenerate', 'admin_regenerate']),
  }),
]);
export type BriefingPayload = z.infer<typeof BriefingPayload>;

const ORIGIN: Readonly<Record<string, 'scheduled' | 'onboarding' | 'retry'>> = {
  schedule: 'scheduled',
  first_analysis: 'onboarding',
  manual_regenerate: 'retry',
  admin_regenerate: 'retry',
};

/** Weekly narratives go through Message Batches until this local time (then synchronously). */
export const WEEKLY_SYNC_FALLBACK = '17:30';

async function resolveBriefing(
  deps: IntelDeps,
  payload: BriefingPayload,
  now: Date,
): Promise<BriefingRow | null> {
  if ('briefing_id' in payload) return await deps.briefings.byId(payload.briefing_id);
  const user = await deps.ai.users.load(payload.user_id);
  return await deps.briefings.ensure({
    user_id: payload.user_id,
    kind: payload.kind,
    local_date: payload.local_date,
    time_zone: user.timeZone,
    scheduled_for: now.toISOString(),
    idempotency_key: briefingKey(payload.user_id, payload.kind, payload.local_date),
    origin: ORIGIN[payload.origin] ?? 'scheduled',
  });
}

function gate(briefing: BriefingRow, user: AiUser): 'not_entitled' | 'flag_off' | null {
  switch (briefing.kind) {
    case 'midday':
      if (!user.isPro) return 'not_entitled';
      return isOn(user.flags, 'feature.midday') ? null : 'flag_off';
    case 'evening':
      if (!user.isPro) return 'not_entitled';
      return isOn(user.flags, 'feature.evening') ? null : 'flag_off';
    case 'weekly':
      return isOn(user.flags, 'feature.weekly_review') ? null : 'flag_off';
    default:
      return null;
  }
}

async function compose(
  deps: IntelDeps,
  ctx: JobContext<BriefingPayload>,
  briefing: BriefingRow,
  user: AiUser,
): Promise<ComposedBriefing | 'batched'> {
  const now = ctx.now();
  const tz = briefing.time_zone || user.timeZone;
  const pipeline = pipelineFor(deps, user, ctx);
  const dayStart = startOfLocalDay(briefing.local_date, tz);
  const dayEnd = endOfLocalDay(briefing.local_date, tz);
  const snapshot = await deps.insights.snapshot(user.userId, now);
  switch (briefing.kind) {
    case 'morning': {
      const [events, carried, mail, freshness] = await Promise.all([
        deps.mail.events(user.userId, dayStart, dayEnd),
        deps.briefings.carriedTo(user.userId, briefing.local_date),
        deps.stats.mailCounts(user.userId, new Date(now.getTime() - 86_400_000), now),
        deps.stats.freshness(user.userId),
      ]);
      return await composeMorning(pipeline, {
        briefing,
        now,
        insights: snapshot.insights,
        events,
        carried,
        mail,
        freshness,
      });
    }
    case 'midday': {
      const morning = await deps.briefings.forDate(user.userId, 'morning', briefing.local_date);
      const events = await deps.mail.events(user.userId, dayStart, dayEnd);
      return await composeMidday(pipeline, {
        briefing,
        morning,
        now,
        insights: snapshot.insights,
        events,
      });
    }
    case 'evening': {
      const tomorrow = addDaysToLocalDate(briefing.local_date, 1);
      const morning = await deps.briefings.forDate(user.userId, 'morning', briefing.local_date);
      const [morningItems, tomorrowEvents] = await Promise.all([
        morning === null ? Promise.resolve([]) : deps.briefings.items(morning.id),
        deps.mail.events(user.userId, startOfLocalDay(tomorrow, tz), endOfLocalDay(tomorrow, tz)),
      ]);
      return await composeEvening(pipeline, {
        briefing,
        now,
        insights: snapshot.insights,
        morningItems,
        tasks: snapshot.tasks,
        commitments: snapshot.commitments,
        tomorrowEvents,
        awaitingSince: Object.fromEntries(
          snapshot.threads.flatMap((t) =>
            t.awaiting_since === null ? [] : [[t.id, t.awaiting_since]],
          ),
        ),
      });
    }
    case 'weekly': {
      const period = weekPeriod(briefing.local_date);
      const nextStart = addDaysToLocalDate(period.end, 1);
      const [counts, nextWeek] = await Promise.all([
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
      ]);
      const input = { briefing, now, counts, insights: snapshot.insights, nextWeek };
      const beforeFallback =
        now.getTime() < atLocalTime(briefing.local_date, WEEKLY_SYNC_FALLBACK, tz).getTime();
      const route =
        beforeFallback && briefing.origin === 'scheduled'
          ? await batchRoute(deps.ai.runtime, {
              feature: 'weekly_review',
              profile: user.profile,
              flags: user.flags,
            })
          : null;
      if (route !== null) {
        await deps.briefings.update(briefing.id, {
          weekly_stats: weeklyStats(counts, period) as unknown as Record<string, unknown>,
          job_id: ctx.job.id,
          provenance: { narrative_mode: 'batch_pending' },
        });
        await ctx.enqueue({
          type: 'ai_batch',
          idempotencyKey: `ai_batch:weekly_review:submit:${ctx.job.id}`,
          payload: {
            phase: 'submit',
            feature: 'weekly_review',
            batch_ref: null,
            item_job_ids: [ctx.job.id],
          },
        });
        return 'batched';
      }
      return await composeWeekly(pipeline, input);
    }
  }
}

/** Persists a composed briefing and enqueues its push (none for skipped rows). */
export async function applyComposed(
  deps: IntelDeps,
  ctx: JobContext<unknown>,
  briefing: BriefingRow,
  composed: ComposedBriefing,
  startedAt: number,
): Promise<void> {
  await deps.briefings.replaceItems(briefing.id, composed.items);
  await deps.briefings.update(briefing.id, {
    ...composed.patch,
    latency_ms: Math.max(0, Date.now() - startedAt),
    job_id: ctx.job.id,
  });
  if (composed.notification !== null && composed.patch.status === 'ready') {
    await enqueueNotification(ctx, briefing.user_id, composed.notification);
  }
}

export async function runBriefing(
  deps: IntelDeps,
  ctx: JobContext<BriefingPayload>,
): Promise<Record<string, string | number>> {
  const now = ctx.now();
  const started = Date.now();
  const briefing = await resolveBriefing(deps, ctx.payload, now);
  if (briefing === null) return { skipped: 'briefing_missing' };
  if (['ready', 'delivered', 'skipped'].includes(briefing.status)) {
    return { briefing_id: briefing.id, status: briefing.status, skipped: 'already_done' };
  }
  const user = await deps.ai.users.load(briefing.user_id);
  const refused = gate(briefing, user);
  if (refused !== null) {
    await deps.briefings.update(briefing.id, {
      status: 'skipped',
      skipped_reason: refused,
      generated_at: now.toISOString(),
    });
    return { briefing_id: briefing.id, status: 'skipped', reason: refused };
  }
  await deps.briefings.update(briefing.id, {
    status: 'generating',
    failed_at: null,
    error_code: null,
  });
  try {
    const composed = await compose(deps, ctx, briefing, user);
    if (composed === 'batched')
      return { briefing_id: briefing.id, status: 'generating', narrative: 'batch' };
    await applyComposed(deps, ctx, briefing, composed, started);
    // JOB-14 step 6: pre-render premium audio (JOB-30) for Pro + `feature.voice` + premium TTS.
    let audio = false;
    if ((composed.patch.status ?? 'ready') === 'ready') {
      try {
        audio = await enqueueBriefingAudio(ctx, deps.ai.runtime, user, briefing);
      } catch {
        ctx.log.warn('briefing_audio_enqueue_failed');
      }
    }
    return {
      audio: audio ? 'queued' : 'none',
      briefing_id: briefing.id,
      status: composed.patch.status ?? 'ready',
      narrative: composed.narrativeMode,
      items: composed.items.length,
      local_time: localTime(now, briefing.time_zone || user.timeZone),
      local_date: localDate(now, briefing.time_zone || user.timeZone),
    };
  } catch (error) {
    const final = ctx.job.attempts >= ctx.job.max_attempts;
    const code = error instanceof JobError ? error.code : 'BRIEFING_FAILED';
    await deps.briefings.update(
      briefing.id,
      final
        ? { status: 'failed', failed_at: new Date().toISOString(), error_code: code }
        : { status: 'scheduled', error_code: code },
    );
    if (error instanceof JobError) throw error;
    throw new JobError(code, !final, null, error instanceof Error ? error.message : undefined);
  }
}

export function briefingJob(deps: IntelDeps) {
  return defineJob({
    type: 'briefing',
    payload: BriefingPayload,
    handler: async (ctx) => ({ ...(await runBriefing(deps, ctx)) }),
    timeoutMs: 120_000,
  });
}
