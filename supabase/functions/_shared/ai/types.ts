/**
 * AI provider abstraction types (AI_PIPELINE_PLAN §15.2, IMPLEMENTATION_PLAN T-3.09).
 *
 * Model IDs are data: they come from `ai_model_config` rows (primary, fallback and escalation
 * targets) and are never literals in product code (§3.7). Model-specific request rules are keyed by
 * the target's `params` (and its optional `params.capabilities` flags), never by model name.
 */
import type { AiFeature, AiTier, RoutingProfile } from '@da/domain';
import type { z } from 'zod';

export type { AiFeature, AiTier, RoutingProfile };

/** `ai_requests.provider` / `ai_model_config.provider` values. */
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'voyage'
  | 'deepgram'
  | 'azure_speech'
  | 'elevenlabs'
  | 'fixture'
  | 'native';

export type ModelRole =
  'classifier' | 'reasoning' | 'assistant' | 'embedding' | 'stt' | 'tts' | 'probe';

/**
 * Capability flags of a model target (`params.capabilities` in `ai_model_config`). Absent flags use
 * the conservative defaults below: no sampling parameters, no prefill, no `inference_geo`, and
 * `effort` / `thinking` only when the target's params carry them.
 */
export interface ModelCapabilities {
  /** `temperature` / `top_p` / `top_k` accepted (default false: never sent). */
  readonly sampling?: boolean;
  /** Assistant prefill accepted (default false). */
  readonly prefill?: boolean;
  /** `output_config.effort` accepted (default: sent only when `params.effort` is set). */
  readonly effort?: boolean;
  /** Minimum cacheable prefix in tokens; no cache breakpoint is placed below it (default 1024). */
  readonly min_cache_prefix_tokens?: number;
  /** `inference_geo` accepted (default false: never sent). */
  readonly inference_geo?: boolean;
}

export interface TargetParams {
  readonly max_output_tokens?: number;
  readonly timeout_ms?: number;
  readonly ttft_timeout_ms?: number;
  readonly thinking?: {
    readonly type: 'adaptive' | 'disabled' | 'enabled';
    readonly budget_tokens?: number;
  };
  readonly effort?: 'minimal' | 'low' | 'medium' | 'high';
  readonly temperature?: number;
  readonly inference_geo?: string;
  readonly input_type?: 'document' | 'query';
  readonly output_dimension?: number;
  readonly language?: string;
  readonly voice?: string;
  readonly region?: string;
  readonly format?: 'mp3' | 'aac';
  readonly capabilities?: ModelCapabilities;
  readonly [key: string]: unknown;
}

export interface ModelTarget {
  readonly provider: ProviderId;
  readonly model: string;
  readonly params: TargetParams;
}

/** One `ai_model_config` row (DATABASE_AND_RLS_PLAN §4.4, AI_PIPELINE_PLAN §3.6). */
export interface ModelConfigRow {
  readonly id: string;
  readonly profile: RoutingProfile;
  readonly role: ModelRole;
  readonly feature: AiFeature;
  readonly tier: AiTier;
  readonly provider: ProviderId;
  readonly model: string;
  readonly params: TargetParams;
  readonly fallback_targets: readonly {
    provider: ProviderId;
    model: string;
    params?: TargetParams;
  }[];
  readonly escalation_target: { provider: ProviderId; model: string; params?: TargetParams } | null;
  readonly batch_policy: 'never' | 'non_urgent' | 'always';
  readonly cache_ttl: '5m' | '1h' | null;
  readonly max_input_tokens: number;
  readonly enabled: boolean;
  readonly version: number;
}

export interface Route {
  readonly feature: AiFeature;
  readonly profile: RoutingProfile;
  readonly role: ModelRole;
  readonly tier: AiTier;
  /** Primary first, then the usable fallbacks, in order. */
  readonly chain: readonly ModelTarget[];
  readonly escalation: ModelTarget | null;
  readonly batchPolicy: ModelConfigRow['batch_policy'];
  readonly cacheTtl: '5m' | '1h' | null;
  readonly maxInputTokens: number;
  readonly configId: string;
  readonly configVersion: number;
  /** Targets dropped by kill switches or open breakers, for logs. */
  readonly skipped: readonly { provider: ProviderId; model: string; reason: string }[];
}

export type T0Reason =
  | 'kill_switch'
  | 'feature_disabled'
  | 'not_configured'
  | 'no_target'
  | 'ai_budget_exhausted'
  | 'ai_unavailable';

export type RouteDecision = { kind: 'route'; route: Route } | { kind: 't0'; reason: T0Reason };

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 5-minute cache writes (`ai_requests.cache_write_tokens`). */
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
  reasoningTokens: number;
  audioSeconds?: number;
  characters?: number;
}

export function emptyUsage(): NormalizedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
  };
}

/** Prompt parts: a static (cacheable) system prefix, trusted context and wrapped untrusted data. */
export interface PromptParts {
  readonly system: string;
  readonly userContext?: string;
  /** Output of `wrapAll()` (nonce-delimited untrusted blocks); never part of the cached prefix. */
  readonly untrusted?: string;
  readonly instruction?: string;
  readonly images?: readonly {
    ref: string;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    b64: string;
  }[];
  readonly pdf?: { ref: string; b64: string };
  readonly cacheTtl?: '5m' | '1h' | null;
}

export interface GenerateStructuredParams<T> {
  readonly feature: AiFeature;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly prompt: PromptParts;
  /** HMAC pseudonym of the user for provider abuse monitoring (`metadata.user_id`). */
  readonly userRef: string | null;
  readonly correlationId: string;
  readonly signal?: AbortSignal;
}

export type StopReason = 'end' | 'max_tokens' | 'refusal';

export interface GenerateStructuredResult<T> {
  readonly data: T;
  readonly usage: NormalizedUsage;
  readonly stopReason: StopReason;
  readonly latencyMs: number;
  readonly ttftMs?: number;
  readonly requestId?: string;
  readonly httpStatus?: number;
}

export interface SearchResultDoc {
  /** Request alias, e.g. `r1`. */
  readonly source: string;
  readonly title: string;
  readonly sentences: readonly string[];
}

export interface StreamParams {
  readonly system: string;
  readonly history: readonly { role: 'user' | 'assistant'; text: string }[];
  readonly question: string;
  readonly results: readonly SearchResultDoc[];
  readonly userRef: string | null;
  readonly correlationId: string;
  readonly signal?: AbortSignal;
}

export type StreamEvent =
  | {
      type: 'text';
      text: string;
      citations: { resultIndex: number; source: string; citedText: string }[];
    }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'stop'; stopReason: StopReason };

export interface EmbedParams {
  readonly inputs: readonly string[];
  readonly kind: 'document' | 'query';
  readonly signal?: AbortSignal;
}

export interface EmbedResult {
  readonly vectors: number[][];
  readonly usage: { tokens: number };
  readonly dimensions: number;
}

export interface TranscribeParams {
  readonly audio: Uint8Array;
  readonly mime: string;
  readonly language: 'tr' | 'en';
  readonly keyterms?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface TranscribeResult {
  readonly text: string;
  readonly confidence: number | null;
  readonly usage: { audioSeconds: number };
}

export interface SynthesizeParams {
  readonly text: string;
  readonly language: 'tr-TR' | 'en-US';
  readonly format: 'mp3' | 'aac';
  readonly signal?: AbortSignal;
}

export interface SynthesizeResult {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly usage: { characters: number };
}

/**
 * `LLMProvider` (T-3.09): every adapter implements the operations its vendor supports; the router
 * never sends an operation to an adapter that lacks it.
 */
export interface LLMProvider {
  readonly id: ProviderId;
  generateStructured?<T>(
    params: GenerateStructuredParams<T>,
    target: ModelTarget,
  ): Promise<GenerateStructuredResult<T>>;
  stream?(params: StreamParams, target: ModelTarget): AsyncIterable<StreamEvent>;
  embed?(params: EmbedParams, target: ModelTarget): Promise<EmbedResult>;
  transcribe?(params: TranscribeParams, target: ModelTarget): Promise<TranscribeResult>;
  synthesize?(params: SynthesizeParams, target: ModelTarget): Promise<SynthesizeResult>;
}

export type AiOperation = 'generate' | 'embed' | 'transcribe' | 'synthesize' | 'probe';
