/**
 * AI telemetry: one `ai_requests` row per provider attempt, plus `cached` / `budget_blocked` /
 * `killed` rows at cost 0 (AI_PIPELINE_PLAN §15.4, M§126, IMPLEMENTATION_PLAN T-3.09).
 *
 * Rows hold counts, costs, hashes and ids only: no prompts, outputs, subjects, names or addresses.
 * `buildAiRequestRow` accepts only the allow-listed columns below; anything else is dropped, so a
 * caller cannot add a content field by accident.
 */
import type { AiFeature, AiTier, RoutingProfile, SourceType } from '@da/domain';
import type { DbClient } from '../db/clients.ts';
import { mapDbError } from '../errors.ts';
import { toByteaHex } from '../crypto/encoding.ts';
import type { AiOperation, NormalizedUsage, ProviderId } from './types.ts';

export type AiRequestStatus =
  | 'ok'
  | 'error'
  | 'refused'
  | 'timeout'
  | 'budget_blocked'
  | 'killed'
  | 'cached'
  | 'validation_failed'
  | 'grounding_partial'
  | 'grounding_failed';

/** The only columns telemetry may write (a subset of `ai_requests`, DB §4.4). */
export const AI_REQUEST_COLUMNS = [
  'id',
  'user_id',
  'plan',
  'profile',
  'feature',
  'tier',
  'provider',
  'model',
  'prompt_version_id',
  'schema_name',
  'schema_hash',
  'feature_variant',
  'operation',
  'batch',
  'batch_id',
  'status',
  'error_code',
  'http_status',
  'provider_request_id',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_write_1h_tokens',
  'reasoning_tokens',
  'audio_seconds',
  'characters',
  'units_charged',
  'latency_ms',
  'ttft_ms',
  'retry_count',
  'fallback_used',
  'fallback_from_model',
  'inference_geo',
  'cost_usd_micros',
  'source_type',
  'source_count',
  'content_hash',
  'grounding_proposed',
  'grounding_verified',
  'grounding_dropped',
  'citation_coverage',
  'injection_suspected',
  'correlation_id',
  'job_id',
] as const;
export type AiRequestColumn = (typeof AI_REQUEST_COLUMNS)[number];

/** Field names that would carry content; they never appear in a telemetry row. */
export const CONTENT_FIELD_NAMES = [
  'prompt',
  'system',
  'messages',
  'input',
  'output',
  'completion',
  'response',
  'text',
  'content',
  'subject',
  'body',
  'snippet',
  'email',
  'name',
  'address',
  'question',
  'answer',
  'result',
] as const;

export interface AiAttemptRecord {
  readonly userId: string | null;
  readonly plan: 'free' | 'pro' | null;
  readonly profile: RoutingProfile | null;
  readonly feature: AiFeature;
  readonly tier: AiTier | null;
  readonly provider: ProviderId;
  readonly model: string;
  readonly operation: AiOperation;
  readonly status: AiRequestStatus;
  readonly promptVersionId?: string | null;
  readonly schemaName?: string | null;
  readonly schemaHash?: string | null;
  readonly featureVariant?: string | null;
  readonly batch?: boolean;
  readonly batchId?: string | null;
  readonly errorCode?: string | null;
  readonly httpStatus?: number | null;
  readonly providerRequestId?: string | null;
  readonly usage?: NormalizedUsage;
  readonly unitsCharged?: number;
  readonly latencyMs: number;
  readonly ttftMs?: number | null;
  readonly retryCount?: number;
  readonly fallbackUsed?: boolean;
  readonly fallbackFromModel?: string | null;
  readonly inferenceGeo?: string | null;
  readonly costUsdMicros?: number;
  readonly sourceType?: SourceType | null;
  readonly sourceCount?: number | null;
  readonly contentHash?: Uint8Array | null;
  readonly groundingProposed?: number | null;
  readonly groundingVerified?: number | null;
  readonly groundingDropped?: number | null;
  readonly citationCoverage?: number | null;
  readonly injectionSuspected?: boolean;
  readonly correlationId: string | null;
  readonly jobId?: string | null;
}

export type AiRequestRow = Partial<Record<AiRequestColumn, string | number | boolean | null>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds the insert row from an attempt record (allow-listed columns only). */
export function buildAiRequestRow(record: AiAttemptRecord): AiRequestRow {
  const usage = record.usage;
  const row: AiRequestRow = {
    user_id: record.userId,
    plan: record.plan,
    profile: record.profile,
    feature: record.feature,
    tier: record.tier,
    provider: record.provider,
    model: record.model,
    prompt_version_id: record.promptVersionId ?? null,
    schema_name: record.schemaName ?? null,
    schema_hash: record.schemaHash ?? null,
    feature_variant: record.featureVariant ?? null,
    operation: record.operation,
    batch: record.batch ?? false,
    batch_id: record.batchId ?? null,
    status: record.status,
    error_code: record.errorCode ?? null,
    http_status: record.httpStatus ?? null,
    provider_request_id: record.providerRequestId ?? null,
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_tokens: usage?.cacheReadTokens ?? 0,
    cache_write_tokens: usage?.cacheWriteTokens ?? 0,
    cache_write_1h_tokens: usage?.cacheWrite1hTokens ?? 0,
    reasoning_tokens: usage?.reasoningTokens ?? 0,
    audio_seconds: usage?.audioSeconds ?? null,
    characters: usage?.characters ?? null,
    units_charged: record.unitsCharged ?? 0,
    latency_ms: Math.max(0, Math.round(record.latencyMs)),
    ttft_ms: record.ttftMs ?? null,
    retry_count: record.retryCount ?? 0,
    fallback_used: record.fallbackUsed ?? false,
    fallback_from_model: record.fallbackFromModel ?? null,
    inference_geo: record.inferenceGeo ?? null,
    cost_usd_micros: record.costUsdMicros ?? 0,
    source_type: record.sourceType ?? null,
    source_count: record.sourceCount ?? null,
    content_hash:
      record.contentHash === undefined || record.contentHash === null
        ? null
        : toByteaHex(record.contentHash),
    grounding_proposed: record.groundingProposed ?? null,
    grounding_verified: record.groundingVerified ?? null,
    grounding_dropped: record.groundingDropped ?? null,
    citation_coverage: record.citationCoverage ?? null,
    injection_suspected: record.injectionSuspected ?? false,
    correlation_id:
      record.correlationId !== null && UUID_RE.test(record.correlationId)
        ? record.correlationId
        : null,
    job_id: record.jobId ?? null,
  };
  const allowed = new Set<string>(AI_REQUEST_COLUMNS);
  for (const key of Object.keys(row))
    if (!allowed.has(key)) delete (row as Record<string, unknown>)[key];
  return row;
}

/** Grounding verifier counters of one served output (AI_PIPELINE_PLAN §11; IT-AI-03). */
export interface GroundingCounts {
  readonly proposed: number;
  readonly verified: number;
  readonly dropped: number;
}

export interface TelemetrySink {
  /** Inserts one row and returns its id. */
  insert(row: AiRequestRow): Promise<string>;
  /** Writes `grounding_*` on the row of the attempt that served the output (after verification). */
  annotate?(id: string, counts: GroundingCounts): Promise<void>;
}

const SMALLINT_MAX = 32_767;
const small = (n: number) => Math.max(0, Math.min(SMALLINT_MAX, Math.round(n)));

export function supabaseTelemetrySink(client: DbClient): TelemetrySink {
  return {
    async insert(row) {
      const { data, error } = await client.from('ai_requests').insert(row).select('id').single();
      if (error !== null) throw mapDbError(error);
      return (data as { id: string }).id;
    },
    async annotate(id, counts) {
      const { error } = await client
        .from('ai_requests')
        .update({
          grounding_proposed: small(counts.proposed),
          grounding_verified: small(counts.verified),
          grounding_dropped: small(counts.dropped),
        })
        .eq('id', id);
      if (error !== null) throw mapDbError(error);
    },
  };
}

/** Records the grounding counters; like every telemetry write it never breaks the caller. */
export async function recordGrounding(
  sink: TelemetrySink,
  id: string | null,
  counts: GroundingCounts,
): Promise<boolean> {
  if (id === null || sink.annotate === undefined || counts.proposed === 0) return false;
  try {
    await sink.annotate(id, counts);
    return true;
  } catch {
    return false;
  }
}

/** Records an attempt; telemetry failures never break the AI call (they are logged by the caller). */
export async function recordAttempt(
  sink: TelemetrySink,
  record: AiAttemptRecord,
): Promise<string | null> {
  try {
    return await sink.insert(buildAiRequestRow(record));
  } catch {
    return null;
  }
}
