/**
 * ElevenLabs TTS (AI_PIPELINE_PLAN §3.3 #21, IMPLEMENTATION_PLAN T-3.10), behind `voice.tts_premium`
 * with `TTS_PREMIUM_PROVIDER=elevenlabs`. Raw `fetch`:
 * `POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128`.
 * The model id comes from the target, the voice id from the target params; `TTS_API_KEY` is the key.
 */
import { AiError, aiErrorFromHttp, normalizeAiError } from '../errors.ts';
import type { LLMProvider, ModelTarget, SynthesizeParams, SynthesizeResult } from '../types.ts';
import { timeoutMs } from './capabilities.ts';

export interface ElevenLabsOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

export function elevenLabsRequest(
  params: SynthesizeParams,
  target: ModelTarget,
): { url: string; body: Record<string, unknown> } {
  const voice = target.params.voice;
  if (typeof voice !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(voice))
    throw new AiError('NOT_CONFIGURED', 'elevenlabs');
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  return {
    url: url.href,
    body: { text: params.text, model_id: target.model, language_code: params.language.slice(0, 2) },
  };
}

export function createElevenLabsProvider(options: ElevenLabsOptions): LLMProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'elevenlabs',
    async synthesize(params: SynthesizeParams, target: ModelTarget): Promise<SynthesizeResult> {
      const request = elevenLabsRequest(params, target);
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs(target));
        response = await doFetch(request.url, {
          method: 'POST',
          headers: {
            'xi-api-key': options.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify(request.body),
          signal: params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]),
        });
      } catch (error) {
        throw normalizeAiError('elevenlabs', error);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw aiErrorFromHttp('elevenlabs', response.status);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mime: 'audio/mpeg',
        usage: { characters: params.text.length },
      };
    },
  };
}
