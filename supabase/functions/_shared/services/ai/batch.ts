/**
 * Message Batches for non-urgent structured calls (AI_PIPELINE_PLAN §8.8; JOB-28 `ai_batch`).
 *
 * Submit: the route of the feature must start at an adapter with batch support (Anthropic); the
 * budget is reserved per item, the prompt is assembled from the active prompt version and the
 * batch id is recorded in `ai_batches`. Collect: results are parsed, schema-validated, passed
 * through the output validators, costed with the batch discount and settled; each result is
 * applied once by the caller. Purge deletes the provider-side results after collection.
 */
import type { AiFeature } from '@da/domain';
import type { z } from 'zod';
import type { AiRuntime } from '../../ai/call.ts';
import { validateOutput } from '../../ai/output-validators.ts';
import { costMicros, estimateMicros, maxOutputTokens } from '../../ai/pricing.ts';
import type { AnthropicBatches } from '../../ai/providers/anthropic.ts';
import { anthropicUsage } from '../../ai/providers/anthropic.ts';
import { resolveRoute } from '../../ai/router.ts';
import { recordAttempt } from '../../ai/telemetry.ts';
import type { ModelTarget, NormalizedUsage, PromptParts, RoutingProfile } from '../../ai/types.ts';
import type { FlagMap } from '../flags.ts';

type Json = Record<string, unknown>;

export interface BatchRoute {
  readonly target: ModelTarget;
  readonly batches: AnthropicBatches;
  readonly tier: 't0' | 't1' | 't2' | 't3';
}

/** The batch-capable primary target of a feature route, or null (then run synchronously). */
export async function batchRoute(
  runtime: AiRuntime,
  input: { feature: AiFeature; profile: RoutingProfile; flags: FlagMap },
): Promise<BatchRoute | null> {
  if (input.flags['ai.batch.enabled'] !== true) return null;
  const decision = await resolveRoute(runtime.router, input);
  if (decision.kind !== 'route') return null;
  const target = decision.route.chain[0];
  if (target === undefined || target.provider !== 'anthropic') return null;
  const provider = runtime.provider('anthropic') as (ReturnType<AiRuntime['provider']> & { batches?: AnthropicBatches }) | null;
  if (provider === null || provider.batches === undefined) return null;
  return { target, batches: provider.batches, tier: decision.route.tier as BatchRoute['tier'] };
}

export interface BatchSubmitItem<T> {
  readonly customId: string;
  readonly userId: string;
  readonly feature: AiFeature;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly prompt: PromptParts;
  readonly userRef: string | null;
  readonly correlationId: string;
  readonly units: number;
}

export type BatchSubmitOutcome =
  | { readonly kind: 'submitted'; readonly batchId: string; readonly reservations: Record<string, string | null> }
  | { readonly kind: 'refused'; readonly reason: string };

export async function submitBatch<T>(
  runtime: AiRuntime,
  route: BatchRoute,
  items: readonly BatchSubmitItem<T>[],
): Promise<BatchSubmitOutcome> {
  const price = await runtime.prices.price(route.target.provider, route.target.model);
  const reservations: Record<string, string | null> = {};
  const accepted: BatchSubmitItem<T>[] = [];
  for (const item of items) {
    const est = estimateMicros(
      price,
      Math.ceil((item.prompt.system.length + (item.prompt.untrusted ?? "").length + (item.prompt.userContext ?? "").length) / 3.2),
      maxOutputTokens(route.target),
    );
    const reservation = await runtime.budget.reserve({
      userId: item.userId,
      feature: item.feature,
      estCostMicros: Math.ceil(est / 2),
      units: item.units,
    });
    if (!reservation.allow) continue;
    reservations[item.customId] = reservation.reservationId;
    accepted.push(item);
  }
  if (accepted.length === 0) return { kind: 'refused', reason: 'budget' };
  const { batchId } = await route.batches.submit(
    accepted.map((item) => ({
      customId: item.customId,
      params: {
        feature: item.feature,
        schema: item.schema,
        schemaName: item.schemaName,
        prompt: item.prompt,
        userRef: item.userRef,
        correlationId: item.correlationId,
      },
    })),
    route.target,
  );
  return { kind: 'submitted', batchId, reservations };
}

export interface BatchResult<T> {
  readonly customId: string;
  readonly data: T | null;
  readonly usage: NormalizedUsage | null;
  readonly error: string | null;
}

function messageText(message: Json): string | null {
  const content = message.content;
  if (!Array.isArray(content)) return null;
  const text = content.find((b) => (b as Json).type === 'text') as Json | undefined;
  return typeof text?.text === 'string' ? text.text : null;
}

/** Parses one succeeded batch message into the schema (null when invalid). */
export function parseBatchMessage<T>(
  message: Json,
  schema: z.ZodType<T>,
  validation: { sources: readonly string[]; aliases: ReadonlySet<string>; canary?: string },
): { data: T | null; usage: NormalizedUsage; error: string | null } {
  const usage = anthropicUsage(message.usage as never);
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') {
    return { data: null, usage, error: String(message.stop_reason ?? 'stop') };
  }
  const text = messageText(message);
  if (text === null) return { data: null, usage, error: 'no_text' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { data: null, usage, error: 'schema_validation' };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { data: null, usage, error: 'schema_validation' };
  const validated = validateOutput(schema, parsed.data, validation);
  return validated.ok ? { data: validated.data, usage, error: null } : { data: null, usage, error: validated.reason };
}

/** `ended` → every result; otherwise the provider state. */
export async function collectBatch<T>(
  route: Pick<BatchRoute, 'batches'>,
  batchId: string,
  schema: z.ZodType<T>,
  validation: (customId: string) => { sources: readonly string[]; aliases: ReadonlySet<string>; canary?: string },
): Promise<{ state: 'in_progress' | 'canceling' | 'ended'; results: BatchResult<T>[] }> {
  const state = await route.batches.poll(batchId);
  if (state !== 'ended') return { state, results: [] };
  const results: BatchResult<T>[] = [];
  for await (const r of route.batches.results(batchId)) {
    if (!r.ok || r.message === undefined) {
      results.push({ customId: r.customId, data: null, usage: null, error: r.error?.code.toLowerCase() ?? 'errored' });
      continue;
    }
    const parsed = parseBatchMessage(r.message as Json, schema, validation(r.customId));
    results.push({ customId: r.customId, data: parsed.data, usage: parsed.usage, error: parsed.error });
  }
  return { state, results };
}

/** Telemetry + budget settlement of one collected item (batch discount applied). */
export async function settleBatchItem(
  runtime: AiRuntime,
  input: {
    readonly route: Pick<BatchRoute, 'target' | 'tier'>;
    readonly batchId: string;
    readonly userId: string;
    readonly plan: 'free' | 'pro';
    readonly profile: RoutingProfile;
    readonly feature: AiFeature;
    readonly promptVersionId: string | null;
    readonly schemaName: string;
    readonly reservationId: string | null;
    readonly usage: NormalizedUsage | null;
    readonly ok: boolean;
    readonly error: string | null;
    readonly units: number;
    readonly correlationId: string;
    readonly jobId: string | null;
  },
): Promise<string | null> {
  const price = await runtime.prices.price(input.route.target.provider, input.route.target.model);
  const usage = input.usage;
  const cost = usage === null ? 0 : costMicros(price, usage, { batch: true });
  const requestId = await recordAttempt(runtime.telemetry, {
    userId: input.userId,
    plan: input.plan,
    profile: input.profile,
    feature: input.feature,
    tier: input.route.tier,
    provider: input.route.target.provider,
    model: input.route.target.model,
    operation: 'generate',
    status: input.ok ? 'ok' : input.error === 'schema_validation' ? 'validation_failed' : 'error',
    promptVersionId: input.promptVersionId,
    schemaName: input.schemaName,
    batch: true,
    batchId: input.batchId,
    errorCode: input.error,
    ...(usage === null ? {} : { usage }),
    unitsCharged: input.ok ? input.units : 0,
    costUsdMicros: cost,
    latencyMs: 0,
    correlationId: input.correlationId,
    jobId: input.jobId,
  });
  if (input.reservationId !== null) {
    await runtime.budget.settle({
      reservationId: input.reservationId,
      aiRequestId: requestId,
      actualCostMicros: cost,
      units: input.ok ? input.units : 0,
      usage: usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        reasoningTokens: 0,
      },
    });
  }
  return requestId;
}
