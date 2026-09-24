/**
 * OpenAI speech adapters (AI_PIPELINE_PLAN §3.3 #20–21, IMPLEMENTATION_PLAN T-3.10): server STT
 * fallback (`audio.transcriptions`) behind `voice.stt_server`, and TTS (`audio.speech`) behind
 * `voice.tts_premium`. The models come from the `stt` / `tts` rows of `ai_model_config`; the voice
 * from the target params.
 */
import { AiError, normalizeAiError } from '../errors.ts';
import type {
  LLMProvider,
  ModelTarget,
  SynthesizeParams,
  SynthesizeResult,
  TranscribeParams,
  TranscribeResult,
} from '../types.ts';
import { timeoutMs } from './capabilities.ts';
import { openaiClient, type OpenAIOptions } from './openai.ts';

const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
};

export function createOpenAIAudioProvider(options: OpenAIOptions): LLMProvider {
  const client = openaiClient(options);
  return {
    id: 'openai',
    async transcribe(params: TranscribeParams, target: ModelTarget): Promise<TranscribeResult> {
      const extension = EXTENSION_FOR_MIME[params.mime];
      if (extension === undefined) throw new AiError('BAD_REQUEST', 'openai');
      const file = new File([params.audio], `audio.${extension}`, { type: params.mime });
      try {
        const result = (await client.audio.transcriptions.create(
          {
            file,
            model: target.model,
            language: target.params.language ?? params.language,
            ...(params.keyterms === undefined || params.keyterms.length === 0
              ? {}
              : { prompt: params.keyterms.join(', ') }),
          },
          {
            timeout: timeoutMs(target),
            ...(params.signal === undefined ? {} : { signal: params.signal }),
          },
        )) as { text?: string; usage?: { seconds?: number; type?: string } };
        return {
          text: result.text ?? '',
          confidence: null,
          usage: { audioSeconds: result.usage?.seconds ?? 0 },
        };
      } catch (error) {
        throw normalizeAiError('openai', error);
      }
    },
    async synthesize(params: SynthesizeParams, target: ModelTarget): Promise<SynthesizeResult> {
      const voice = target.params.voice;
      if (typeof voice !== 'string' || voice === '') throw new AiError('NOT_CONFIGURED', 'openai');
      try {
        const response = await client.audio.speech.create(
          { model: target.model, voice, input: params.text, response_format: params.format },
          {
            timeout: timeoutMs(target),
            ...(params.signal === undefined ? {} : { signal: params.signal }),
          },
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          bytes,
          mime: params.format === 'mp3' ? 'audio/mpeg' : 'audio/aac',
          usage: { characters: params.text.length },
        };
      } catch (error) {
        throw normalizeAiError('openai', error);
      }
    },
  };
}
