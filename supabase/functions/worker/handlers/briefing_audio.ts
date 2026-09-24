/**
 * JOB-30 `briefing_audio` (IMPLEMENTATION_PLAN T-5.09, T-5.10; API_CONTRACTS §11): premium TTS of a
 * briefing version (`briefing-audio/{user}/{briefing}/{version}.mp3`, then `audio_status='ready'`
 * with duration and chapters) or of a meeting prep's "2 Dakikalık Özet"
 * (`{user}/meeting_prep/{prep}/{source_hash}.mp3`). A second job for the same version is a no-op; a
 * missing credential or the flag being off ends as `audio_status='failed'` and the app keeps
 * native TTS. JOB-14 enqueues it after a ready briefing when premium applies.
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import type { AiRuntime } from '../../_shared/ai/call.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import {
  briefingAudioKey,
  briefingAudioPath,
  briefingChapters,
  meetingAudioPath,
  premiumTtsAvailable,
  renderChapters,
} from '../../_shared/services/briefings/audio.ts';
import { summaryParagraphs } from '../../_shared/services/meetings/prep.ts';
import type { AssistJobDeps } from './assist.ts';

export const BriefingAudioPayload = z.object({
  target: z.enum(['briefing', 'meeting_prep']),
  id: Uuid,
  version: z.string().max(64),
  user_id: Uuid.optional(),
});
export type BriefingAudioPayload = z.infer<typeof BriefingAudioPayload>;

/**
 * JOB-14 step 6: a ready briefing of a Pro user with `feature.voice` and premium TTS is pre-rendered.
 * Returns whether the job was enqueued (never without a usable credential).
 */
export async function enqueueBriefingAudio(
  ctx: JobContext<unknown>,
  runtime: AiRuntime,
  user: AiUser,
  briefing: { id: string; user_id: string; version: number },
): Promise<boolean> {
  if (!user.isPro || user.flags['feature.voice'] !== true) return false;
  if (!(await premiumTtsAvailable(runtime, user))) return false;
  await ctx.enqueue({
    type: 'briefing_audio',
    idempotencyKey: briefingAudioKey('briefing', briefing.id, String(briefing.version)),
    payload: {
      target: 'briefing',
      id: briefing.id,
      version: String(briefing.version),
      user_id: briefing.user_id,
    },
    userId: briefing.user_id,
    maxAttempts: 3,
  });
  return true;
}

export async function runBriefingAudio(
  deps: AssistJobDeps,
  ctx: JobContext<BriefingAudioPayload>,
): Promise<Record<string, string | number>> {
  const userId = ctx.payload.user_id ?? ctx.job.user_id;
  if (userId === null) return { skipped: 'user_missing' };
  const user = await deps.intel.ai.users.load(userId);
  const runtime = deps.intel.ai.runtime;
  const meta = { correlationId: ctx.correlationId, jobId: ctx.job.id, signal: ctx.signal };
  const final = ctx.job.attempts >= ctx.job.max_attempts;

  if (ctx.payload.target === 'briefing') {
    const briefing = await deps.store.briefingAudio(userId, ctx.payload.id);
    if (briefing === null) return { skipped: 'briefing_missing' };
    if (String(briefing.version) !== ctx.payload.version) return { skipped: 'stale_version' };
    const path = briefingAudioPath(userId, briefing.id, briefing.version);
    if (briefing.audio_status === 'ready' && briefing.audio_storage_path === path) {
      return { skipped: 'already_rendered' };
    }
    if (!(await premiumTtsAvailable(runtime, user))) {
      await deps.store.updateBriefingAudio(briefing.id, {
        audio_status: 'failed',
        audio_engine: 'native_tts',
      });
      return { skipped: 'premium_unavailable' };
    }
    await deps.store.updateBriefingAudio(briefing.id, { audio_status: 'generating' });
    const items = await deps.intel.briefings.items(briefing.id);
    const chapters = briefingChapters(briefing, items, user.locale);
    const rendered = await renderChapters(runtime, user, chapters, meta);
    if (rendered.kind !== 'ok') {
      if (rendered.retryable && !final) {
        await deps.store.updateBriefingAudio(briefing.id, { audio_status: 'queued' });
        throw new JobError('TTS_UNAVAILABLE', true);
      }
      await deps.store.updateBriefingAudio(briefing.id, { audio_status: 'failed' });
      return { status: 'failed', reason: rendered.reason };
    }
    await deps.storage.upload('briefing-audio', path, rendered.bytes, 'audio/mpeg');
    await deps.store.updateBriefingAudio(briefing.id, {
      audio_status: 'ready',
      audio_engine: 'premium_tts',
      audio_storage_path: path,
      audio_duration_s: rendered.durationS,
      audio_chapters: rendered.chapters,
    });
    return { status: 'ready', chapters: rendered.chapters.length, duration_s: rendered.durationS };
  }

  const prep = await deps.store.meetingPrepById(userId, ctx.payload.id);
  if (prep === null || prep.status !== 'ready' || prep.source_hash !== ctx.payload.version) {
    return { skipped: 'stale_version' };
  }
  const path = meetingAudioPath(userId, prep.id, ctx.payload.version);
  if ((await deps.storage.stat('briefing-audio', path)) !== null)
    return { skipped: 'already_rendered' };
  if (!(await premiumTtsAvailable(runtime, user))) return { skipped: 'premium_unavailable' };
  const paragraphs = summaryParagraphs(prep);
  if (paragraphs.length === 0) return { skipped: 'no_summary' };
  const rendered = await renderChapters(
    runtime,
    user,
    paragraphs.map((text, i) => ({ title: String(i + 1), text })),
    meta,
  );
  if (rendered.kind !== 'ok') {
    if (rendered.retryable && !final) throw new JobError('TTS_UNAVAILABLE', true);
    return { status: 'failed', reason: rendered.reason };
  }
  await deps.storage.upload('briefing-audio', path, rendered.bytes, 'audio/mpeg');
  return { status: 'ready', duration_s: rendered.durationS };
}

export function briefingAudioJob(deps: AssistJobDeps) {
  return defineJob({
    type: 'briefing_audio',
    payload: BriefingAudioPayload,
    handler: async (ctx) => ({ ...(await runBriefingAudio(deps, ctx)) }),
    timeoutMs: 120_000,
  });
}
