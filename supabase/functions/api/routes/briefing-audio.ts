/**
 * API-BRF-01 `POST /briefings/:id/audio` (IMPLEMENTATION_PLAN T-5.09; M§9, M§25, M§44). Pro
 * (`voice_briefing`, route gate) and `feature.voice`. A rendered premium file of the briefing
 * version answers with a 300 s signed URL and its chapters; when premium TTS applies (Pro,
 * `voice.tts_premium`, a usable TTS credential) the render is enqueued (JOB-30) and the native
 * chapter script is returned with `premium_status:'generating'` (202); otherwise the native script
 * with `notice_key='audio.native_fallback'`. A TTS failure is never an error.
 */
import { BriefingAudioBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { POLL_AFTER_MS } from '../../_shared/services/assist/common.ts';
import {
  briefingAudioKey,
  briefingAudioPath,
  briefingChapters,
  NATIVE_FALLBACK_NOTICE,
  premiumTtsAvailable,
} from '../../_shared/services/briefings/audio.ts';
import { isOn } from '../../_shared/services/flags.ts';
import { SIGNED_AUDIO_TTL_S } from '../../_shared/services/storage.ts';
import type { RouteRegistrar } from '../deps.ts';
import { assistOf } from './assist-api.ts';

export const registerBriefingAudioRoutes: RouteRegistrar = (app, kit) => {
  const route = routes['POST /briefings/:id/audio'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(route),
    validateRequest(route),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, route.request.params);
      const body = validBody(c, BriefingAudioBody);
      const { assist, intel } = assistOf(kit);
      const user = await intel.ai.users.load(auth.userId);
      if (!isOn(user.flags, 'feature.voice')) {
        throw new AppError('FEATURE_DISABLED', { details: { feature: 'voice' } });
      }
      const briefing = await assist.store.briefingAudio(auth.userId, params.id);
      if (briefing === null) throw new AppError('NOT_FOUND', { details: { resource: 'briefing' } });
      if (briefing.status !== 'ready' && briefing.status !== 'delivered') {
        throw new AppError('STATE_CONFLICT', {
          details: { reason: 'briefing_not_ready', status: briefing.status },
        });
      }
      const path = briefingAudioPath(auth.userId, briefing.id, briefing.version);
      const now = kit.now();
      if (
        body.prefer === 'premium' &&
        briefing.audio_status === 'ready' &&
        briefing.audio_storage_path === path
      ) {
        const url = await assist.storage.signedUrl('briefing-audio', path, SIGNED_AUDIO_TTL_S);
        return sendData(c, {
          mode: 'premium',
          url,
          url_expires_at: new Date(now.getTime() + SIGNED_AUDIO_TTL_S * 1000).toISOString(),
          duration_s: briefing.audio_duration_s ?? 0,
          chapters: briefing.audio_chapters,
        });
      }
      const items = await assist.store.briefingItems(auth.userId, briefing.id);
      const chapters = briefingChapters(briefing, items, user.locale);
      const native = (notice: string | null, premium: 'generating' | 'unavailable' | null) => ({
        mode: 'native' as const,
        language: user.locale === 'en' ? 'en-US' : 'tr-TR',
        chapters,
        notice_key: notice,
        premium_status: premium,
      });
      if (body.prefer === 'native') return sendData(c, native(null, null));
      if (
        briefing.audio_status !== 'failed' &&
        (await premiumTtsAvailable(intel.ai.runtime, user))
      ) {
        await kit.deps.repos(auth).jobs.enqueue({
          type: 'briefing_audio',
          idempotencyKey: briefingAudioKey('briefing', briefing.id, String(briefing.version)),
          payload: {
            target: 'briefing',
            id: briefing.id,
            version: String(briefing.version),
            user_id: auth.userId,
          },
          userId: auth.userId,
          maxAttempts: 3,
          correlationId: c.get('correlationId'),
        });
        if (briefing.audio_status === 'none') {
          await assist.store.updateBriefingAudio(briefing.id, { audio_status: 'queued' });
        }
        return sendData(c, native(null, 'generating'), 202, { poll_after_ms: POLL_AFTER_MS });
      }
      return sendData(c, native(NATIVE_FALLBACK_NOTICE, 'unavailable'));
    },
  );
};
