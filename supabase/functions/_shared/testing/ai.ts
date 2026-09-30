/**
 * Shared fixtures for the AI core tests: model-config rows with neutral model identifiers (model IDs
 * are data), a flag map with every switch on, and recording fakes for telemetry, budget and cache.
 */
import type { AiFeature } from '@da/domain';
import type { FlagMap } from '../services/flags.ts';
import type { BudgetGate, Reservation, ReserveInput, SettleInput } from '../ai/budget.ts';
import type { CachedResult, CacheKey, ResultCache } from '../ai/cache.ts';
import type { ModelPrice } from '../ai/pricing.ts';
import type { PromptVersion } from '../ai/prompts/registry.ts';
import type { AiRequestRow, TelemetrySink } from '../ai/telemetry.ts';
import type { ModelConfigRow } from '../ai/types.ts';

export function configRow(overrides: Partial<ModelConfigRow> = {}): ModelConfigRow {
  return {
    id: 'cfg-1',
    profile: 'balanced',
    role: 'reasoning',
    feature: 'thread_summary',
    tier: 't1',
    provider: 'anthropic',
    model: 'primary-model',
    params: { max_output_tokens: 800, timeout_ms: 30_000 },
    fallback_targets: [
      { provider: 'openai', model: 'fallback-model', params: { max_output_tokens: 800 } },
    ],
    escalation_target: null,
    batch_policy: 'never',
    cache_ttl: '5m',
    max_input_tokens: 4000,
    enabled: true,
    version: 3,
    ...overrides,
  };
}

export function allFlags(
  feature: AiFeature = 'thread_summary',
  overrides: Record<string, boolean> = {},
): FlagMap {
  return {
    'ai.global.enabled': true,
    [`ai.feature.${feature}`]: true,
    'ai.provider.anthropic.enabled': true,
    'ai.provider.openai.enabled': true,
    'ai.provider.voyage.enabled': true,
    'ai.model.large.enabled': true,
    'ai.model.opus_escalation': false,
    ...overrides,
  };
}

export function promptVersion(overrides: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: 'pv-1',
    prompt_key: 'thread_summary',
    version: 2,
    system_prompt: 'Sen bir e-posta özetleyicisisin.',
    user_template: '{{threads}}',
    output_schema_ref: 'ThreadSummaryV1',
    schema_hash: 'abc123',
    model_role: 'reasoning',
    model_constraints: { canary: 'CANARY-7f3a9c2e' },
    ...overrides,
  };
}

export const PRICES: readonly ModelPrice[] = [
  {
    provider: 'anthropic',
    model: 'primary-model',
    input_per_mtok_usd: '3.000000',
    output_per_mtok_usd: '15.000000',
    cache_write_5m_per_mtok_usd: '3.750000',
    cache_write_1h_per_mtok_usd: '6.000000',
    cache_read_per_mtok_usd: '0.300000',
    batch_discount: '0.500000',
    audio_per_min_usd: null,
    chars_per_million_usd: null,
    effective_from: '2026-01-01T00:00:00Z',
  },
  {
    provider: 'openai',
    model: 'fallback-model',
    input_per_mtok_usd: 0.25,
    output_per_mtok_usd: 2,
    cache_write_5m_per_mtok_usd: null,
    cache_write_1h_per_mtok_usd: null,
    cache_read_per_mtok_usd: 0.025,
    batch_discount: 0.5,
    audio_per_min_usd: null,
    chars_per_million_usd: null,
    effective_from: '2026-01-01T00:00:00Z',
  },
];

export function recordingTelemetry(): TelemetrySink & { rows: AiRequestRow[] } {
  const rows: AiRequestRow[] = [];
  return {
    rows,
    insert(row) {
      rows.push(row);
      return Promise.resolve(`req-${rows.length}`);
    },
  };
}

export function recordingBudget(reservation: Partial<Reservation> = {}): BudgetGate & {
  reserves: ReserveInput[];
  settles: SettleInput[];
} {
  const reserves: ReserveInput[] = [];
  const settles: SettleInput[] = [];
  return {
    reserves,
    settles,
    reserve(input) {
      reserves.push(input);
      return Promise.resolve({
        allow: true,
        level: 'l0',
        reason: null,
        reservationId: 'res-1',
        ...reservation,
      });
    },
    settle(input) {
      settles.push(input);
      return Promise.resolve();
    },
  };
}

export function memoryCache(): ResultCache & { entries: Map<string, CachedResult> } {
  const entries = new Map<string, CachedResult>();
  const key = (k: CacheKey) =>
    `${k.userId}|${k.feature}|${Array.from(k.contentHash).join(',')}|${k.promptVersionId}`;
  return {
    entries,
    get: (k) => Promise.resolve(entries.get(key(k)) ?? null),
    put(k, value) {
      entries.set(key(k), value);
      return Promise.resolve();
    },
  };
}
