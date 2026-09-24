/**
 * Model-specific request rules derived from the target's config (AI_PIPELINE_PLAN §3.2, §15.3;
 * IMPLEMENTATION_PLAN T-3.10). Rules are keyed by `params` and `params.capabilities` flags stored in
 * `ai_model_config` (primary, fallback and escalation targets), never by model name:
 * - `thinking` is sent only when the target params carry it;
 * - `effort` is sent only when the params carry it and `capabilities.effort` is not `false`;
 * - sampling parameters only with `capabilities.sampling`; prefill only with `capabilities.prefill`;
 * - `inference_geo` only with `capabilities.inference_geo`;
 * - a prompt-cache breakpoint only when the static prefix reaches
 *   `capabilities.min_cache_prefix_tokens` (default 1,024).
 */
import type { ModelTarget } from '../types.ts';

export const DEFAULT_MIN_CACHE_PREFIX_TOKENS = 1024;

export function sendThinking(target: ModelTarget): ModelTarget['params']['thinking'] | undefined {
  return target.params.thinking;
}

export function sendEffort(target: ModelTarget): ModelTarget['params']['effort'] | undefined {
  if (target.params.capabilities?.effort === false) return undefined;
  return target.params.effort;
}

export function samplingAllowed(target: ModelTarget): boolean {
  return target.params.capabilities?.sampling === true;
}

export function prefillAllowed(target: ModelTarget): boolean {
  return target.params.capabilities?.prefill === true;
}

export function sendInferenceGeo(target: ModelTarget): string | undefined {
  return target.params.capabilities?.inference_geo === true
    ? target.params.inference_geo
    : undefined;
}

export function minCachePrefixTokens(target: ModelTarget): number {
  const value = target.params.capabilities?.min_cache_prefix_tokens;
  return typeof value === 'number' && value > 0 ? value : DEFAULT_MIN_CACHE_PREFIX_TOKENS;
}

/**
 * Conservative token estimate for Turkish text (≈3 characters per token with the newer tokenizers),
 * used only to decide whether a cache breakpoint can take effect.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function timeoutMs(target: ModelTarget, fallback = 30_000): number {
  const value = target.params.timeout_ms;
  return typeof value === 'number' && value > 0 ? value : fallback;
}
