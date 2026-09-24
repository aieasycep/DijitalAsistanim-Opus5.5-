/**
 * Embeddings through the AI router (R-01; AI_PIPELINE_PLAN §10.3; JOB-16; API-SRCH-01).
 *
 * Documents use the `(profile, 'embedding_doc')` route (`input_type: document`), queries the
 * `(profile, 'embedding_query')` route (`input_type: query`); both live in one 1024-d space. There
 * is no hot cross-provider fallback: a missing key, a kill switch, an open breaker or a provider
 * failure returns `unavailable` and the caller degrades (chunks stored without a vector, search
 * on FTS only). Every attempt writes `ai_requests`; the cost settles into `ai_usage_daily`.
 */
import type { AiFeature } from '@da/domain';
import type { AiRuntime } from '../../ai/call.ts';
import { AiError } from '../../ai/errors.ts';
import { costMicros, estimateMicros } from '../../ai/pricing.ts';
import { resolveRoute } from '../../ai/router.ts';
import { recordAttempt } from '../../ai/telemetry.ts';
import { emptyUsage, type RoutingProfile } from '../../ai/types.ts';
import type { FlagMap } from '../flags.ts';

export const EMBEDDING_DIMENSIONS = 1024;
/** Provider batch limit (Voyage ≤128 inputs). */
export const EMBED_BATCH = 128;

export interface EmbedInput {
  readonly feature: Extract<AiFeature, 'embedding_doc' | 'embedding_query'>;
  readonly userId: string;
  readonly plan: 'free' | 'pro';
  readonly profile: RoutingProfile;
  readonly flags: FlagMap;
  readonly inputs: readonly string[];
  readonly correlationId: string;
  readonly jobId?: string | null;
  readonly signal?: AbortSignal;
}

export type EmbedOutcome =
  | { readonly kind: 'ok'; readonly vectors: number[][]; readonly model: string }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: boolean };

/** `memory_chunks.embedding_model` label, e.g. `voyage-4@1024`. */
export function embeddingModelLabel(model: string, dimensions: number): string {
  return `${model}@${dimensions}`;
}

const approxTokens = (inputs: readonly string[]): number =>
  Math.ceil(inputs.reduce((n, s) => n + s.length, 0) / 3.2);

export async function embedTexts(runtime: AiRuntime, input: EmbedInput): Promise<EmbedOutcome> {
  if (input.inputs.length === 0) return { kind: 'ok', vectors: [], model: '' };
  const decision = await resolveRoute(runtime.router, {
    feature: input.feature,
    profile: input.profile,
    flags: input.flags,
    role: 'embedding',
  });
  if (decision.kind !== 'route') return { kind: 'unavailable', reason: decision.reason, retryable: false };
  const target = decision.route.chain[0];
  const provider = target === undefined ? null : runtime.provider(target.provider);
  if (target === undefined || provider === null || provider.embed === undefined) {
    return { kind: 'unavailable', reason: 'no_target', retryable: false };
  }
  const price = await runtime.prices.price(target.provider, target.model);
  const reservation = await runtime.budget.reserve({
    userId: input.userId,
    feature: input.feature,
    estCostMicros: estimateMicros(price, approxTokens(input.inputs), 0),
    units: 0,
  });
  if (!reservation.allow) {
    return { kind: 'unavailable', reason: reservation.reason ?? 'budget', retryable: false };
  }
  const now = runtime.now ?? Date.now;
  const vectors: number[][] = [];
  let tokens = 0;
  let dimensions = EMBEDDING_DIMENSIONS;
  const started = now();
  let requestId: string | null = null;
  try {
    for (let i = 0; i < input.inputs.length; i += EMBED_BATCH) {
      const result = await provider.embed(
        {
          inputs: input.inputs.slice(i, i + EMBED_BATCH),
          kind: input.feature === 'embedding_doc' ? 'document' : 'query',
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        target,
      );
      if (result.dimensions !== EMBEDDING_DIMENSIONS) throw new AiError('SCHEMA_VALIDATION', target.provider);
      dimensions = result.dimensions;
      tokens += result.usage.tokens;
      vectors.push(...result.vectors);
    }
  } catch (error) {
    const code = error instanceof AiError ? error.code : 'NETWORK';
    await recordAttempt(runtime.telemetry, {
      userId: input.userId,
      plan: input.plan,
      profile: input.profile,
      feature: input.feature,
      tier: decision.route.tier,
      provider: target.provider,
      model: target.model,
      operation: 'embed',
      status: 'error',
      errorCode: code,
      latencyMs: now() - started,
      correlationId: input.correlationId,
      jobId: input.jobId ?? null,
    });
    if (reservation.reservationId !== null) {
      await runtime.budget.settle({
        reservationId: reservation.reservationId,
        aiRequestId: null,
        actualCostMicros: 0,
        units: 0,
        usage: emptyUsage(),
      });
    }
    const retryable = error instanceof AiError ? error.retryable : true;
    return { kind: 'unavailable', reason: code.toLowerCase(), retryable };
  }
  const usage = { ...emptyUsage(), inputTokens: tokens };
  const cost = costMicros(price, usage);
  requestId = await recordAttempt(runtime.telemetry, {
    userId: input.userId,
    plan: input.plan,
    profile: input.profile,
    feature: input.feature,
    tier: decision.route.tier,
    provider: target.provider,
    model: target.model,
    operation: 'embed',
    status: 'ok',
    usage,
    costUsdMicros: cost,
    latencyMs: now() - started,
    correlationId: input.correlationId,
    jobId: input.jobId ?? null,
  });
  if (reservation.reservationId !== null) {
    await runtime.budget.settle({
      reservationId: reservation.reservationId,
      aiRequestId: requestId,
      actualCostMicros: cost,
      units: 0,
      usage,
    });
  }
  return { kind: 'ok', vectors, model: embeddingModelLabel(target.model, dimensions) };
}
