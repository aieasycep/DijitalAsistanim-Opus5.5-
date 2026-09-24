/**
 * JOB-15 `meeting_prep` (IMPLEMENTATION_PLAN T-5.10; API_CONTRACTS §11; R-23): Pro check, the
 * `feature.meeting_prep` flag, attendees → contacts → derived sources → source-set hash → T2
 * `MeetingPrepV1` (T0 fallback without a model) → `meeting_preps` `ready`. A prep whose source set
 * did not change is not regenerated. The scheduler enqueues it at T-60 for external / VIP meetings
 * (`{event_id, trigger:'schedule'}`); API-MEET-01 enqueues it on tap. The last failed attempt
 * marks the prep `failed`.
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import { isOn } from '../../_shared/services/flags.ts';
import { composePrep, loadPrepSources } from '../../_shared/services/meetings/prep.ts';
import { type AssistJobDeps, assistPipeline, jobUserId } from './assist.ts';

export const MeetingPrepPayload = z.object({
  user_id: Uuid.optional(),
  calendar_event_id: Uuid.optional(),
  event_id: Uuid.optional(),
  trigger: z.enum(['schedule', 'user', 'event_changed']).default('user'),
});
export type MeetingPrepPayload = z.infer<typeof MeetingPrepPayload>;

export async function runMeetingPrep(
  deps: AssistJobDeps,
  ctx: JobContext<MeetingPrepPayload>,
): Promise<Record<string, string | number>> {
  const userId = jobUserId(ctx, ctx.payload.user_id);
  const eventId = ctx.payload.calendar_event_id ?? ctx.payload.event_id;
  if (userId === null || eventId === undefined) return { skipped: 'payload_incomplete' };
  const user = await deps.intel.ai.users.load(userId);
  if (!user.isPro) return { skipped: 'not_entitled' };
  if (!isOn(user.flags, 'feature.meeting_prep')) return { skipped: 'flag_off' };
  const event = await deps.store.meetingEvent(userId, eventId);
  if (event === null || event.status === 'cancelled') return { skipped: 'event_gone' };
  const now = ctx.now();
  const sources = await loadPrepSources(deps.store, userId, event, now);
  const existing = await deps.store.meetingPrep(userId, eventId);
  if (
    existing?.status === 'ready' &&
    existing.source_hash === sources.hash &&
    ctx.payload.trigger !== 'user'
  ) {
    return { prep_id: existing.id, skipped: 'unchanged' };
  }
  try {
    const composed = await composePrep(assistPipeline(deps, user, ctx), sources, now);
    const row = await deps.store.upsertMeetingPrep(composed.row);
    return { prep_id: row.id, mode: composed.mode, points: row.talking_points.length };
  } catch (error) {
    const final = ctx.job.attempts >= ctx.job.max_attempts;
    if (final && existing !== null) {
      await deps.store.upsertMeetingPrep({
        ...existing,
        status: existing.status === 'ready' ? 'ready' : 'failed',
        source_provider: event.provider,
        source_timestamp: event.updated_at,
        confidence: 0.5,
      });
    }
    if (error instanceof JobError) throw error;
    throw new JobError(
      'MEETING_PREP_FAILED',
      !final,
      null,
      error instanceof Error ? error.message : undefined,
    );
  }
}

export function meetingPrepJob(deps: AssistJobDeps) {
  return defineJob({
    type: 'meeting_prep',
    payload: MeetingPrepPayload,
    handler: async (ctx) => ({ ...(await runMeetingPrep(deps, ctx)) }),
    timeoutMs: 90_000,
  });
}
