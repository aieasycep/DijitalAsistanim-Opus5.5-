/**
 * AI cost from `ai_model_prices` (AI_PIPELINE_PLAN §8.13, DATABASE_AND_RLS_PLAN §4.4).
 *
 * $X per million tokens = X µ$ per token. Prices are parsed from their decimal text into integer
 * pico-dollars per token and summed with `BigInt`, so accounting never uses floating point:
 * `cost = input×in + cache_write_5m×cw5 + cache_write_1h×cw1h + cache_read×cr + output×out
 * (+ audio minutes × audio + characters × chars/1e6)`, × (1 − batch_discount) for batches,
 * × 1.1 with `inference_geo = "us"`. Prices are cached per isolate for 60 s.
 */
import type { DbClient } from '../db/clients.ts';
import { mapDbError } from '../errors.ts';
import type { ModelTarget, NormalizedUsage, ProviderId } from './types.ts';

export interface ModelPrice {
  readonly provider: string;
  readonly model: string;
  readonly input_per_mtok_usd: number | string;
  readonly output_per_mtok_usd: number | string;
  readonly cache_write_5m_per_mtok_usd: number | string | null;
  readonly cache_write_1h_per_mtok_usd: number | string | null;
  readonly cache_read_per_mtok_usd: number | string | null;
  readonly batch_discount: number | string;
  readonly audio_per_min_usd: number | string | null;
  readonly chars_per_million_usd: number | string | null;
  readonly effective_from: string;
}

const SCALE = 1_000_000n;

/** Decimal (number or text) → integer scaled by 10^6, exactly for up to 6 decimals. */
export function toScaled(value: number | string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  const text = typeof value === 'number' ? value.toFixed(6) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return 0n;
  const [, sign, whole, frac = ''] = match;
  const scaled = BigInt(whole ?? '0') * SCALE + BigInt((frac + '000000').slice(0, 6));
  return sign === '-' ? -scaled : scaled;
}

/** Rounds `numerator / denominator` half-up for non-negative bigints. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export interface CostOptions {
  readonly batch?: boolean;
  readonly inferenceGeo?: string | null;
}

/** Cost of one attempt in µ$ (integer). */
export function costMicros(
  price: ModelPrice | null,
  usage: NormalizedUsage,
  options: CostOptions = {},
): number {
  if (price === null) return 0;
  // pico-dollars: tokens × (µ$/token × 10^6)
  let pico =
    BigInt(usage.inputTokens) * toScaled(price.input_per_mtok_usd) +
    BigInt(usage.outputTokens) * toScaled(price.output_per_mtok_usd) +
    BigInt(usage.cacheWriteTokens) * toScaled(price.cache_write_5m_per_mtok_usd) +
    BigInt(usage.cacheWrite1hTokens) * toScaled(price.cache_write_1h_per_mtok_usd) +
    BigInt(usage.cacheReadTokens) * toScaled(price.cache_read_per_mtok_usd);
  if (usage.audioSeconds !== undefined && usage.audioSeconds > 0) {
    // $/min × 10^6 µ$ × seconds / 60 → pico: × 10^6
    const centiSeconds = BigInt(Math.round(usage.audioSeconds * 100));
    pico += divRound(toScaled(price.audio_per_min_usd) * SCALE * centiSeconds, 6000n);
  }
  if (usage.characters !== undefined && usage.characters > 0) {
    // $/1M chars = µ$/char
    pico += BigInt(usage.characters) * toScaled(price.chars_per_million_usd);
  }
  if (options.batch === true) {
    const discount = toScaled(price.batch_discount);
    pico = divRound(pico * (SCALE - discount), SCALE);
  }
  if (options.inferenceGeo === 'us') pico = divRound(pico * 11n, 10n);
  return Number(divRound(pico, SCALE));
}

/** Upper-bound estimate for the budget reservation: max input × in + max output × out. */
export function estimateMicros(
  price: ModelPrice | null,
  maxInputTokens: number,
  maxOutputTokens: number,
): number {
  if (price === null) return 0;
  const pico =
    BigInt(maxInputTokens) * toScaled(price.input_per_mtok_usd) +
    BigInt(maxOutputTokens) * toScaled(price.output_per_mtok_usd);
  return Number(divRound(pico, SCALE));
}

export interface PriceSource {
  price(provider: ProviderId, model: string): Promise<ModelPrice | null>;
}

/** `ai_model_prices`: the latest row with `effective_from <= now` per (provider, model). */
export function supabasePriceSource(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): PriceSource {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; rows: ModelPrice[] } | null = null;
  const load = async (): Promise<ModelPrice[]> => {
    if (cache !== null && now() - cache.at < ttl) return cache.rows;
    const { data, error } = await client
      .from('ai_model_prices')
      .select(
        'provider,model,input_per_mtok_usd,output_per_mtok_usd,cache_write_5m_per_mtok_usd,cache_write_1h_per_mtok_usd,cache_read_per_mtok_usd,batch_discount,audio_per_min_usd,chars_per_million_usd,effective_from',
      )
      .lte('effective_from', new Date(now()).toISOString())
      .order('effective_from', { ascending: false });
    if (error !== null) throw mapDbError(error);
    cache = { at: now(), rows: (data ?? []) as ModelPrice[] };
    return cache.rows;
  };
  return {
    async price(provider, model) {
      const rows = await load();
      return rows.find((r) => r.provider === provider && r.model === model) ?? null;
    },
  };
}

export function staticPriceSource(rows: readonly ModelPrice[]): PriceSource {
  return {
    price: (provider, model) =>
      Promise.resolve(rows.find((r) => r.provider === provider && r.model === model) ?? null),
  };
}

export function maxOutputTokens(target: ModelTarget, fallback = 1024): number {
  const value = target.params.max_output_tokens;
  return typeof value === 'number' && value > 0 ? value : fallback;
}
