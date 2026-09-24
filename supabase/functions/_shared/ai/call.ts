/**
 * Structured AI call orchestration (AI_PIPELINE_PLAN §15.1 `call.ts`, IMPLEMENTATION_PLAN T-3.09):
 *
 * route (kill switches, profile, config, fallbacks) → active prompt version → per-user result cache
 * → budget reservation → provider attempts along the chain (retry inside each target, then the next
 * fallback) → zod + output validators → one `ai_requests` row per attempt (no content) → budget
 * settlement → cache store.
 *
 * The result is either `{kind:'ai'}` or `{kind:'t0', reason}`: kill switches, a missing config, an
 * exhausted budget (`ai_budget_exhausted`) or an unavailable chain never throw — the caller runs its
 * deterministic T0 path (background) or maps the reason to an API error (interactive).
 */
import type { AiFeature, InjectionScan } from '@da/domain';
import type { PromptKey } from '@da/validation';
import type { z } from 'zod';
import type { Json } from '../jobs/types.ts';
import type { Logger } from '../logging/logger.ts';
import type { FlagMap } from '../services/flags.ts';
import { type BudgetGate, type Reservation } from './budget.ts';
import { type CacheKey, contentHash, type ResultCache } from './cache.ts';
import { AiError, normalizeAiError, telemetryStatus } from './errors.ts';
import { validateOutput } from './output-validators.ts';
import { costMicros, estimateMicros, maxOutputTokens, type PriceSource } from './pricing.ts';
import {
  FEATURE_PROMPT_KEY,
  promptCanary,
  type PromptSource,
  type PromptVersion,
} from './prompts/registry.ts';
import { withRetry } from './retry.ts';
import { resolveRoute, type RouterDeps } from './router.ts';
import { recordAttempt, type TelemetrySink } from './telemetry.ts';
import type {
  LLMProvider,
  ModelRole,
  ModelTarget,
  NormalizedUsage,
  PromptParts,
  ProviderId,
  RoutingProfile,
  T0Reason,
} from './types.ts';
import { emptyUsage } from './types.ts';

export interface AiRuntime {
  readonly router: RouterDeps;
  readonly prompts: PromptSource;
  readonly prices: PriceSource;
  readonly telemetry: TelemetrySink;
  readonly budget: BudgetGate;
  readonly cache: ResultCache;
  /** Resolves the adapter serving a provider (the fixture provider serves all in fixture mode). */
  readonly provider: (id: ProviderId) => LLMProvider | null;
  readonly aiHashPepper: string | null;
  readonly log: Logger;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface StructuredCallInput<T> {
  readonly feature: AiFeature;
  readonly userId: string | null;
  readonly plan: 'free' | 'pro' | null;
  readonly profile: RoutingProfile;
  readonly flags: FlagMap;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  /** Builds the prompt from the active prompt version. */
  readonly buildPrompt: (version: PromptVersion) => PromptParts;
  /** Normalised content for the per-user cache key; omit to skip the cache. */
  readonly cacheContent?: string;
  /** Output-validator context. */
  readonly sources: readonly string[];
  readonly aliases: ReadonlySet<string>;
  readonly injection?: InjectionScan;
  readonly units: number;
  readonly correlationId: string;
  readonly jobId?: string | null;
  readonly role?: ModelRole;
  readonly promptKey?: PromptKey;
  readonly userRef?: string | null;
  readonly signal?: AbortSignal;
}

export type StructuredCallResult<T> =
  | {
      readonly kind: 'ai';
      readonly data: T;
      readonly provider: ProviderId;
      readonly model: string;
      readonly cached: boolean;
      readonly aiRequestId: string | null;
      readonly promptVersionId: string;
      readonly level: Reservation['level'];
    }
  | { readonly kind: 't0'; readonly reason: T0Reason; readonly error?: AiError };

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export async function generateStructured<T>(
  runtime: AiRuntime,
  input: StructuredCallInput<T>,
): Promise<StructuredCallResult<T>> {
  const now = runtime.now ?? Date.now;
  const log = runtime.log.child({ feature: input.feature, correlation_id: input.correlationId });
  const base = {
    userId: input.userId,
    plan: input.plan,
    profile: input.profile,
    feature: input.feature,
    correlationId: input.correlationId,
    jobId: input.jobId ?? null,
    schemaName: input.schemaName,
    operation: 'generate' as const,
  };

  const decision = await resolveRoute(runtime.router, {
    feature: input.feature,
    profile: input.profile,
    flags: input.flags,
    ...(input.role === undefined ? {} : { role: input.role }),
  });
  if (decision.kind === 't0') {
    await recordAttempt(runtime.telemetry, {
      ...base,
      tier: 't0',
      provider: 'native',
      model: 't0',
      status: 'killed',
      errorCode: decision.reason,
      latencyMs: 0,
    });
    log.info('ai_t0', { reason: decision.reason });
    return { kind: 't0', reason: decision.reason };
  }
  const route = decision.route;
  const promptKey = input.promptKey ?? FEATURE_PROMPT_KEY[input.feature];
  if (promptKey === undefined) return { kind: 't0', reason: 'not_configured' };
  let version: PromptVersion;
  try {
    version = await runtime.prompts.active(promptKey);
  } catch (error) {
    if (error instanceof AiError && error.code === 'NOT_CONFIGURED')
      return { kind: 't0', reason: 'not_configured' };
    throw error;
  }
  const withPrompt = {
    ...base,
    tier: route.tier,
    promptVersionId: version.id,
    schemaHash: version.schema_hash,
  };

  // Per-user result cache (R-02).
  let cacheKey: CacheKey | null = null;
  let hash: Uint8Array | null = null;
  if (input.cacheContent !== undefined && input.userId !== null && runtime.aiHashPepper !== null) {
    hash = await contentHash(runtime.aiHashPepper, input.userId, input.cacheContent);
    cacheKey = {
      userId: input.userId,
      feature: input.feature,
      contentHash: hash,
      promptVersionId: version.id,
    };
    const hit = await runtime.cache.get(cacheKey);
    if (hit !== null) {
      const parsed = input.schema.safeParse(hit.result);
      if (parsed.success) {
        const first = route.chain[0];
        const id = await recordAttempt(runtime.telemetry, {
          ...withPrompt,
          provider: first?.provider ?? 'native',
          model: hit.model,
          status: 'cached',
          contentHash: hash,
          latencyMs: 0,
        });
        return {
          kind: 'ai',
          data: parsed.data,
          provider: first?.provider ?? 'native',
          model: hit.model,
          cached: true,
          aiRequestId: id,
          promptVersionId: version.id,
          level: 'l0',
        };
      }
    }
  }

  // Budget reservation (users only; system calls such as probes carry no user budget).
  let reservation: Reservation = { allow: true, level: 'l0', reason: null, reservationId: null };
  const primary = route.chain[0] as ModelTarget;
  if (input.userId !== null) {
    const price = await runtime.prices.price(primary.provider, primary.model);
    reservation = await runtime.budget.reserve({
      userId: input.userId,
      feature: input.feature,
      estCostMicros: estimateMicros(price, route.maxInputTokens, maxOutputTokens(primary)),
      units: input.units,
    });
    if (!reservation.allow) {
      await recordAttempt(runtime.telemetry, {
        ...withPrompt,
        provider: primary.provider,
        model: primary.model,
        status: 'budget_blocked',
        errorCode: reservation.reason,
        latencyMs: 0,
      });
      log.info('ai_budget_blocked', { reason: reservation.reason, level: reservation.level });
      return { kind: 't0', reason: 'ai_budget_exhausted' };
    }
  }

  const prompt = input.buildPrompt(version);
  const canary = promptCanary(version);
  let totalCost = 0;
  let totalUsage = emptyUsage();
  let lastRequestId: string | null = null;
  let lastError: AiError | null = null;
  const chain = route.chain;

  for (let index = 0; index < chain.length; index++) {
    const target = chain[index] as ModelTarget;
    const adapter = runtime.provider(target.provider);
    const fallbackFields =
      index === 0 ? {} : { fallbackUsed: true, fallbackFromModel: primary.model };
    const generate = adapter?.generateStructured?.bind(adapter);
    if (generate === undefined) {
      lastError = new AiError('UNSUPPORTED_OPERATION', target.provider);
      continue;
    }
    const price = await runtime.prices.price(target.provider, target.model);
    const started = now();
    try {
      const result = await withRetry(
        () =>
          generate(
            {
              feature: input.feature,
              schema: input.schema,
              schemaName: input.schemaName,
              prompt,
              userRef: input.userRef ?? null,
              correlationId: input.correlationId,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
            target,
          ),
        {
          provider: target.provider,
          deadline:
            started +
            (typeof target.params.timeout_ms === 'number' ? target.params.timeout_ms : 30_000),
          now,
          ...(runtime.random === undefined ? {} : { random: runtime.random }),
          ...(runtime.sleep === undefined ? {} : { sleep: runtime.sleep }),
          onAttemptError: async (error, attempt) => {
            lastRequestId =
              (await recordAttempt(runtime.telemetry, {
                ...withPrompt,
                ...fallbackFields,
                provider: target.provider,
                model: target.model,
                status: telemetryStatus(error),
                errorCode: error.code,
                httpStatus: error.httpStatus,
                providerRequestId: error.requestId,
                latencyMs: now() - started,
                retryCount: attempt,
                contentHash: hash,
              })) ?? lastRequestId;
          },
        },
      );
      const cost = costMicros(price, result.usage);
      totalCost += cost;
      totalUsage = addUsage(totalUsage, result.usage);
      if (result.stopReason !== 'end') {
        const error = new AiError(
          result.stopReason === 'refusal' ? 'REFUSAL' : 'MAX_TOKENS',
          target.provider,
        );
        lastRequestId =
          (await recordAttempt(runtime.telemetry, {
            ...withPrompt,
            ...fallbackFields,
            provider: target.provider,
            model: target.model,
            status: telemetryStatus(error),
            errorCode: error.code,
            usage: result.usage,
            costUsdMicros: cost,
            latencyMs: result.latencyMs,
            contentHash: hash,
          })) ?? lastRequestId;
        lastError = error;
        continue;
      }
      const validated = validateOutput(input.schema, result.data, {
        sources: input.sources,
        aliases: input.aliases,
        ...(canary === undefined ? {} : { canary }),
        ...(input.injection === undefined ? {} : { injection: input.injection }),
      });
      const status = validated.ok ? 'ok' : 'validation_failed';
      const requestId = await recordAttempt(runtime.telemetry, {
        ...withPrompt,
        ...fallbackFields,
        provider: target.provider,
        model: target.model,
        status,
        errorCode: validated.ok ? null : validated.reason,
        usage: result.usage,
        unitsCharged: validated.ok ? input.units : 0,
        costUsdMicros: cost,
        latencyMs: result.latencyMs,
        ttftMs: result.ttftMs ?? null,
        providerRequestId: result.requestId ?? null,
        httpStatus: result.httpStatus ?? null,
        contentHash: hash,
        injectionSuspected: input.injection?.suspected === true,
      });
      lastRequestId = requestId ?? lastRequestId;
      if (!validated.ok) {
        log.warn('ai_output_rejected', { reason: validated.reason, provider: target.provider });
        lastError = new AiError('OUTPUT_REJECTED', target.provider);
        continue;
      }
      await settle(runtime, reservation, lastRequestId, totalCost, input.units, totalUsage, log);
      if (cacheKey !== null) {
        await runtime.cache
          .put(cacheKey, { result: validated.data as Json, model: target.model })
          .catch(() => {
            log.warn('ai_cache_store_failed');
          });
      }
      return {
        kind: 'ai',
        data: validated.data,
        provider: target.provider,
        model: target.model,
        cached: false,
        aiRequestId: lastRequestId,
        promptVersionId: version.id,
        level: reservation.level,
      };
    } catch (thrown) {
      const error = normalizeAiError(target.provider, thrown);
      lastError = error;
      if (!error.triggersFallback) break;
    }
  }

  await settle(runtime, reservation, lastRequestId, totalCost, 0, totalUsage, log);
  log.warn('ai_chain_exhausted', { error_code: lastError?.code ?? null });
  return lastError === null
    ? { kind: 't0', reason: 'ai_unavailable' }
    : { kind: 't0', reason: 'ai_unavailable', error: lastError };
}

async function settle(
  runtime: AiRuntime,
  reservation: Reservation,
  aiRequestId: string | null,
  cost: number,
  units: number,
  usage: NormalizedUsage,
  log: Logger,
): Promise<void> {
  if (reservation.reservationId === null) return;
  try {
    await runtime.budget.settle({
      reservationId: reservation.reservationId,
      aiRequestId,
      actualCostMicros: cost,
      units,
      usage,
    });
  } catch {
    log.error('ai_budget_settle_failed');
  }
}
