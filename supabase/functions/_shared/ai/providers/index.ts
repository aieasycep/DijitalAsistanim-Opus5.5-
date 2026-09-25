/**
 * The AI provider set of one isolate (AI_PIPELINE_PLAN §15, IMPLEMENTATION_PLAN T-3.09/T-3.10).
 *
 * Adapters are constructed only when their credential is present; otherwise the router drops their
 * targets and the feature reports `external_credential_required`. Premium voice adapters are
 * selected by `STT_SERVER_PROVIDER` / `TTS_PREMIUM_PROVIDER`. In fixture mode (tests, CI, allowed
 * demo) the fixture provider serves every target and no vendor is called.
 *
 * Test-only base-URL overrides (`ANTHROPIC_API_BASE_URL`, `OPENAI_API_BASE_URL`,
 * `VOYAGE_API_BASE_URL`; the mock provider server of the integration tier) are honoured only outside
 * preview and production, where the env schema also refuses them.
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

/** A test-only `*_BASE_URL` override, or undefined (always undefined in preview/production). */
export function testBaseUrl(raw: RawEnv, key: string): string | undefined {
  const appEnv = raw.APP_ENV?.trim();
  if (appEnv === 'production' || appEnv === 'preview') return undefined;
  const value = raw[key]?.trim() ?? '';
  return value === '' ? undefined : value;
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
      const baseURL = testBaseUrl(raw, 'ANTHROPIC_API_BASE_URL');
      adapters.set(
        'anthropic',
        createAnthropicProvider({
          apiKey: anthropicKey,
          ...fetchOpt,
          ...(baseURL === undefined ? {} : { baseURL }),
        }),
      );
    }
    const openaiKey = raw.OPENAI_API_KEY?.trim();
    if (openaiKey !== undefined && openaiKey !== '') {
      const baseURL = testBaseUrl(raw, 'OPENAI_API_BASE_URL');
      adapters.set(
        'openai',
        merge(
          createOpenAIProvider({
            apiKey: openaiKey,
            ...fetchOpt,
            ...(baseURL === undefined ? {} : { baseURL }),
          }),
          createOpenAIAudioProvider({ apiKey: openaiKey, ...fetchOpt }),
        ),
      );
    }
    const voyageKey = raw.VOYAGE_API_KEY?.trim();
    if (voyageKey !== undefined && voyageKey !== '') {
      const voyageBase = testBaseUrl(raw, 'VOYAGE_API_BASE_URL');
      adapters.set(
        'voyage',
        createVoyageProvider({
          apiKey: voyageKey,
          ...fetchOpt,
          ...(voyageBase === undefined ? {} : { baseUrl: voyageBase }),
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
