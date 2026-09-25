/**
 * The AI provider set of one isolate (AI_PIPELINE_PLAN §15, IMPLEMENTATION_PLAN T-3.09/T-3.10).
 *
 * Adapters are constructed only when their credential is present; otherwise the router drops their
 * targets and the feature reports `external_credential_required`. Premium voice adapters are
 * selected by `STT_SERVER_PROVIDER` / `TTS_PREMIUM_PROVIDER`. In fixture mode (tests, CI, allowed
 * demo) the fixture provider serves every target and no vendor is called.
 */
import { credentialStatus, type RawEnv } from '../../env.ts';
import type { LLMProvider, ProviderId } from '../types.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createAzureTtsProvider } from './azure-tts.ts';
import { createDeepgramProvider } from './deepgram.ts';
import { createElevenLabsProvider } from './elevenlabs.ts';
import { createFixtureProvider, fixtureProviderEnabled } from './fixture.ts';
import { createOpenAIProvider } from './openai.ts';
import { createOpenAIAudioProvider } from './openai-audio.ts';
import { createVoyageProvider } from './voyage.ts';

export interface AiProviderSet {
  readonly fixtureMode: boolean;
  get(id: ProviderId): LLMProvider | null;
  available(id: ProviderId): boolean;
}

function merge(a: LLMProvider, b: LLMProvider): LLMProvider {
  return { ...b, ...a, id: a.id } as LLMProvider;
}

export function createAiProviders(
  raw: RawEnv,
  options: { fetch?: typeof fetch } = {},
): AiProviderSet {
  const fixtureMode = fixtureProviderEnabled(raw);
  const fixture = fixtureMode ? createFixtureProvider() : null;
  const adapters = new Map<ProviderId, LLMProvider>();
  const fetchOpt = options.fetch === undefined ? {} : { fetch: options.fetch };

  if (!fixtureMode) {
    const anthropicKey = raw.ANTHROPIC_API_KEY?.trim();
    if (anthropicKey !== undefined && anthropicKey !== '') {
      adapters.set('anthropic', createAnthropicProvider({ apiKey: anthropicKey, ...fetchOpt }));
    }
    const openaiKey = raw.OPENAI_API_KEY?.trim();
    if (openaiKey !== undefined && openaiKey !== '') {
      adapters.set(
        'openai',
        merge(
          createOpenAIProvider({ apiKey: openaiKey, ...fetchOpt }),
          createOpenAIAudioProvider({ apiKey: openaiKey, ...fetchOpt }),
        ),
      );
    }
    const voyageKey = raw.VOYAGE_API_KEY?.trim();
    if (voyageKey !== undefined && voyageKey !== '') {
      const appEnv = raw.APP_ENV?.trim();
      const voyageBase =
        appEnv === 'production' || appEnv === 'preview'
          ? ''
          : (raw.VOYAGE_API_BASE_URL?.trim() ?? '');
      adapters.set(
        'voyage',
        createVoyageProvider({
          apiKey: voyageKey,
          ...fetchOpt,
          ...(voyageBase === '' ? {} : { baseUrl: voyageBase }),
        }),
      );
    }
    const sttKey = raw.STT_API_KEY?.trim();
    if (raw.STT_SERVER_PROVIDER?.trim() === 'deepgram' && sttKey !== undefined && sttKey !== '') {
      adapters.set('deepgram', createDeepgramProvider({ apiKey: sttKey, ...fetchOpt }));
    }
    const ttsProvider = raw.TTS_PREMIUM_PROVIDER?.trim();
    const ttsKey = raw.TTS_API_KEY?.trim();
    if (credentialStatus('tts_premium', raw).status === 'configured' && ttsKey !== undefined) {
      if (ttsProvider === 'azure')
        adapters.set('azure_speech', createAzureTtsProvider({ apiKey: ttsKey, ...fetchOpt }));
      if (ttsProvider === 'elevenlabs')
        adapters.set('elevenlabs', createElevenLabsProvider({ apiKey: ttsKey, ...fetchOpt }));
    }
  }

  return {
    fixtureMode,
    get(id) {
      if (fixture !== null) return fixture;
      return adapters.get(id) ?? null;
    },
    available(id) {
      return fixture !== null || adapters.has(id);
    },
  };
}
