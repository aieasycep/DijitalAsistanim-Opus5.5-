/**
 * Azure Speech TTS (AI_PIPELINE_PLAN §3.3 #21, IMPLEMENTATION_PLAN T-3.10), behind
 * `voice.tts_premium` with `TTS_PREMIUM_PROVIDER=azure`. Raw `fetch`:
 * `POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1` with SSML. Region and voice
 * come from the target params (`region`, `voice`); `TTS_API_KEY` is the subscription key.
 */
import { AiError, aiErrorFromHttp, normalizeAiError } from '../errors.ts';
import type { LLMProvider, ModelTarget, SynthesizeParams, SynthesizeResult } from '../types.ts';
import { timeoutMs } from './capabilities.ts';

export interface AzureTtsOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

const OUTPUT_FORMAT: Readonly<Record<SynthesizeParams['format'], string>> = {
  mp3: 'audio-24khz-48kbitrate-mono-mp3',
  aac: 'audio-24khz-48kbitrate-mono-mp3',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function azureSsml(params: SynthesizeParams, voice: string): string {
  return `<speak version="1.0" xml:lang="${params.language}"><voice name="${escapeXml(voice)}">${escapeXml(params.text)}</voice></speak>`;
}

export function azureEndpoint(region: string): string {
  if (!/^[a-z0-9]+$/.test(region)) throw new AiError('NOT_CONFIGURED', 'azure_speech');
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function createAzureTtsProvider(options: AzureTtsOptions): LLMProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'azure_speech',
    async synthesize(params: SynthesizeParams, target: ModelTarget): Promise<SynthesizeResult> {
      const region = target.params.region;
      const voice = target.params.voice;
      if (typeof region !== 'string' || typeof voice !== 'string')
        throw new AiError('NOT_CONFIGURED', 'azure_speech');
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs(target));
        response = await doFetch(azureEndpoint(region), {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': options.apiKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': OUTPUT_FORMAT[params.format],
            'User-Agent': 'DijitalAsistan',
          },
          body: azureSsml(params, voice),
          signal: params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]),
        });
      } catch (error) {
        throw normalizeAiError('azure_speech', error);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw aiErrorFromHttp('azure_speech', response.status);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mime: 'audio/mpeg',
        usage: { characters: params.text.length },
      };
    },
  };
}
