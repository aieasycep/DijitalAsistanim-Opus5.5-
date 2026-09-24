/**
 * Deepgram pre-recorded STT (AI_PIPELINE_PLAN §3.3 #20, IMPLEMENTATION_PLAN T-3.10), behind the
 * `voice.stt_server` flag with `STT_SERVER_PROVIDER=deepgram`. Raw `fetch`:
 * `POST https://api.deepgram.com/v1/listen?model=<model>&language=<lang>&smart_format=true` with the
 * audio bytes. The model comes from the `stt` fallback target. `STT_API_KEY` is the credential.
 */
import { aiErrorFromHttp, normalizeAiError } from '../errors.ts';
import type { LLMProvider, ModelTarget, TranscribeParams, TranscribeResult } from '../types.ts';
import { timeoutMs } from './capabilities.ts';

export const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen';

export interface DeepgramOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

export function deepgramUrl(params: TranscribeParams, target: ModelTarget): string {
  const url = new URL(DEEPGRAM_ENDPOINT);
  url.searchParams.set('model', target.model);
  url.searchParams.set('language', target.params.language ?? params.language);
  url.searchParams.set('smart_format', 'true');
  for (const term of params.keyterms ?? []) url.searchParams.append('keyterm', term);
  return url.href;
}

export function createDeepgramProvider(options: DeepgramOptions): LLMProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'deepgram',
    async transcribe(params: TranscribeParams, target: ModelTarget): Promise<TranscribeResult> {
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs(target));
        response = await doFetch(deepgramUrl(params, target), {
          method: 'POST',
          headers: { Authorization: `Token ${options.apiKey}`, 'Content-Type': params.mime },
          body: params.audio,
          signal: params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]),
        });
      } catch (error) {
        throw normalizeAiError('deepgram', error);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw aiErrorFromHttp('deepgram', response.status);
      }
      const json = (await response.json()) as {
        metadata?: { duration?: number };
        results?: {
          channels?: { alternatives?: { transcript?: string; confidence?: number }[] }[];
        };
      };
      const alternative = json.results?.channels?.[0]?.alternatives?.[0];
      return {
        text: alternative?.transcript ?? '',
        confidence: typeof alternative?.confidence === 'number' ? alternative.confidence : null,
        usage: { audioSeconds: json.metadata?.duration ?? 0 },
      };
    },
  };
}
