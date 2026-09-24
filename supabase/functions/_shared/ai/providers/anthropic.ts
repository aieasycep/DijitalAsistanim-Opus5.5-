/**
 * Anthropic adapter (AI_PIPELINE_PLAN §3.2, §15.3; IMPLEMENTATION_PLAN T-3.10). Official SDK only.
 *
 * - Structured output: `output_config.format = zodOutputFormat(schema)` and the SDK's structured
 *   parser (the one `messages.parse` applies) run on `messages.create(...).withResponse()`, so the
 *   `request-id` survives; `stop_reason` is checked before parsing; a parse failure is
 *   `SCHEMA_VALIDATION`.
 * - Prompt cache: an explicit `cache_control` breakpoint on the static system block when the prefix
 *   reaches the target's `min_cache_prefix_tokens` (1h TTL for batch / briefing prefixes).
 * - Model-specific rules come from the target params and capability flags (`capabilities.ts`):
 *   `thinking` and `effort` only when configured, no sampling parameters or prefill unless flagged,
 *   no `inference_geo` unless flagged.
 * - Streaming grounded answers: `search_result` blocks with citations enabled; the adapter emits text
 *   deltas with `search_result_location` citations.
 * - Message Batches: submit / poll / results / purge (`DELETE` right after ingest).
 * - SDK retries are disabled (`maxRetries: 0`); retries and fallbacks are ours.
 * `ANTHROPIC_API_KEY` missing → the provider is not constructed (`external_credential_required`).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { parseMessage } from '@anthropic-ai/sdk/lib/parser';
import type { z } from 'zod';
import { AiError, normalizeAiError } from '../errors.ts';
import type {
  GenerateStructuredParams,
  GenerateStructuredResult,
  LLMProvider,
  ModelTarget,
  NormalizedUsage,
  PromptParts,
  StopReason,
  StreamEvent,
  StreamParams,
} from '../types.ts';
import { maxOutputTokens } from '../pricing.ts';
import {
  estimateTokens,
  minCachePrefixTokens,
  samplingAllowed,
  sendEffort,
  sendInferenceGeo,
  sendThinking,
  timeoutMs,
} from './capabilities.ts';

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseURL?: string;
  readonly now?: () => number;
}

type Json = Record<string, unknown>;

/** The SDK parser only logs warnings; they are not needed here. */
const SDK_LOGGER = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

export function anthropicClient(options: AnthropicOptions): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 0,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });
}

function mapStopReason(reason: string | null | undefined): StopReason {
  if (reason === 'refusal') return 'refusal';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens';
  return 'end';
}

export function anthropicUsage(usage: Json | null | undefined): NormalizedUsage {
  const u = (usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    } | null;
    output_tokens_details?: { thinking_tokens?: number } | null;
  };
  const oneHour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMin =
    u.cache_creation?.ephemeral_5m_input_tokens ??
    Math.max(0, (u.cache_creation_input_tokens ?? 0) - oneHour);
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: fiveMin,
    cacheWrite1hTokens: oneHour,
    reasoningTokens: u.output_tokens_details?.thinking_tokens ?? 0,
  };
}

/** The static system block, with a cache breakpoint when the prefix can be cached. */
export function systemBlocks(prompt: PromptParts, target: ModelTarget): Json[] {
  const block: Json = { type: 'text', text: prompt.system };
  if (estimateTokens(prompt.system) >= minCachePrefixTokens(target) && prompt.cacheTtl !== null) {
    block.cache_control =
      prompt.cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  }
  return [block];
}

/** User turn: trusted context, media, untrusted blocks (never cached), instruction. */
export function userContent(prompt: PromptParts): Json[] {
  const content: Json[] = [];
  if (prompt.userContext !== undefined && prompt.userContext !== '')
    content.push({ type: 'text', text: prompt.userContext });
  for (const image of prompt.images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mime, data: image.b64 },
    });
  }
  if (prompt.pdf !== undefined) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: prompt.pdf.b64 },
    });
  }
  if (prompt.untrusted !== undefined && prompt.untrusted !== '')
    content.push({ type: 'text', text: prompt.untrusted });
  if (prompt.instruction !== undefined && prompt.instruction !== '')
    content.push({ type: 'text', text: prompt.instruction });
  return content;
}

/** Request fields shared by synchronous, streaming and batch calls. */
export function baseRequest(target: ModelTarget, userRef: string | null): Json {
  const request: Json = { model: target.model, max_tokens: maxOutputTokens(target) };
  const thinking = sendThinking(target);
  if (thinking !== undefined) request.thinking = thinking;
  if (samplingAllowed(target) && typeof target.params.temperature === 'number')
    request.temperature = target.params.temperature;
  const geo = sendInferenceGeo(target);
  if (geo !== undefined) request.inference_geo = geo;
  if (userRef !== null) request.metadata = { user_id: userRef };
  return request;
}

function outputConfig(target: ModelTarget, format?: unknown): Json | undefined {
  const config: Json = {};
  if (format !== undefined) config.format = format;
  const effort = sendEffort(target);
  if (effort !== undefined && effort !== 'minimal') config.effort = effort;
  return Object.keys(config).length === 0 ? undefined : config;
}

/** The complete `messages.parse` body for a structured call (exported for request-shape tests). */
export function buildStructuredRequest<T>(
  params: GenerateStructuredParams<T>,
  target: ModelTarget,
): Json {
  const request: Json = {
    ...baseRequest(target, params.userRef),
    system: systemBlocks(params.prompt, target),
    messages: [{ role: 'user', content: userContent(params.prompt) }],
  };
  const config = outputConfig(target, zodOutputFormat(params.schema as unknown as z.ZodType));
  if (config !== undefined) request.output_config = config;
  return request;
}

/** Streaming grounded-answer request with `search_result` blocks (citations enabled, no schema). */
export function buildGroundedRequest(params: StreamParams, target: ModelTarget): Json {
  const history = params.history.map((turn) => ({ role: turn.role, content: turn.text }));
  const results = params.results.map((r) => ({
    type: 'search_result',
    source: r.source,
    title: r.title,
    content: r.sentences.map((text) => ({ type: 'text', text })),
    citations: { enabled: true },
  }));
  const request: Json = {
    ...baseRequest(target, params.userRef),
    system: [{ type: 'text', text: params.system }],
    messages: [
      ...history,
      { role: 'user', content: [...results, { type: 'text', text: params.question }] },
    ],
  };
  const config = outputConfig(target);
  if (config !== undefined) request.output_config = config;
  return request;
}

export function createAnthropicProvider(
  options: AnthropicOptions,
): LLMProvider & { batches: AnthropicBatches } {
  const client = anthropicClient(options);
  const now = options.now ?? Date.now;
  return {
    id: 'anthropic',
    async generateStructured<T>(
      params: GenerateStructuredParams<T>,
      target: ModelTarget,
    ): Promise<GenerateStructuredResult<T>> {
      const started = now();
      const request = buildStructuredRequest(params, target);
      let raw: { data: Json; request_id: string | null | undefined };
      try {
        raw = (await client.messages
          .create(request as never, {
            timeout: timeoutMs(target),
            ...(params.signal === undefined ? {} : { signal: params.signal }),
          })
          .withResponse()) as unknown as typeof raw;
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
      const message = raw.data as { stop_reason?: string | null; usage?: Json };
      const requestId = raw.request_id ?? null;
      const stopReason = mapStopReason(message.stop_reason);
      const meta = {
        usage: anthropicUsage(message.usage),
        latencyMs: now() - started,
        ...(requestId === null ? {} : { requestId }),
      };
      // Refusals and truncated outputs are reported before any parsing is attempted.
      if (stopReason !== 'end') return { data: undefined as unknown as T, stopReason, ...meta };
      let parsed: unknown;
      try {
        parsed = parseMessage(raw.data as never, request as never, {
          logger: SDK_LOGGER,
        }).parsed_output;
      } catch {
        throw new AiError('SCHEMA_VALIDATION', 'anthropic');
      }
      const checked = params.schema.safeParse(parsed);
      if (!checked.success) throw new AiError('SCHEMA_VALIDATION', 'anthropic');
      return { data: checked.data, stopReason, ...meta };
    },
    async *stream(params: StreamParams, target: ModelTarget): AsyncIterable<StreamEvent> {
      const request = { ...buildGroundedRequest(params, target), stream: true };
      let events: AsyncIterable<Json>;
      try {
        events = (await client.messages.create(request as never, {
          timeout: timeoutMs(target),
          ...(params.signal === undefined ? {} : { signal: params.signal }),
        })) as unknown as AsyncIterable<Json>;
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
      let usage: NormalizedUsage | null = null;
      let stop: StopReason = 'end';
      try {
        for await (const event of events) {
          const type = event.type;
          if (type === 'message_start') {
            usage = anthropicUsage((event.message as Json | undefined)?.usage as Json | undefined);
          } else if (type === 'content_block_delta') {
            const delta = event.delta as Json;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text', text: delta.text, citations: [] };
            } else if (delta.type === 'citations_delta') {
              const c = delta.citation as Json;
              if (c.type === 'search_result_location') {
                yield {
                  type: 'text',
                  text: '',
                  citations: [
                    {
                      resultIndex: Number(c.search_result_index ?? 0),
                      source: String(c.source ?? ''),
                      citedText: String(c.cited_text ?? ''),
                    },
                  ],
                };
              }
            }
          } else if (type === 'message_delta') {
            const delta = event.delta as Json;
            stop = mapStopReason(delta.stop_reason as string | undefined);
            const u = anthropicUsage(event.usage as Json | undefined);
            const current = usage as NormalizedUsage | null;
            usage =
              current === null
                ? u
                : { ...current, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens };
          }
        }
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
      if (usage !== null) yield { type: 'usage', usage };
      yield { type: 'stop', stopReason: stop };
    },
    batches: anthropicBatches(client),
  };
}

// ── Message Batches ──────────────────────────────────────────────────────────

export interface AnthropicBatches {
  submit<T>(
    items: readonly { customId: string; params: GenerateStructuredParams<T> }[],
    target: ModelTarget,
  ): Promise<{ batchId: string }>;
  poll(batchId: string): Promise<'in_progress' | 'canceling' | 'ended'>;
  results(
    batchId: string,
  ): AsyncIterable<{ customId: string; ok: boolean; message?: Json; error?: AiError }>;
  purge(batchId: string): Promise<void>;
}

export function anthropicBatches(client: Anthropic): AnthropicBatches {
  return {
    async submit(items, target) {
      try {
        const batch = await client.messages.batches.create({
          requests: items.map((item) => ({
            custom_id: item.customId,
            params: buildStructuredRequest(item.params, target) as never,
          })),
        });
        return { batchId: batch.id };
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
    },
    async poll(batchId) {
      try {
        const batch = await client.messages.batches.retrieve(batchId);
        return batch.processing_status;
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
    },
    async *results(batchId) {
      let decoder: AsyncIterable<Json>;
      try {
        decoder = (await client.messages.batches.results(
          batchId,
        )) as unknown as AsyncIterable<Json>;
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
      for await (const line of decoder) {
        const result = line.result as Json;
        const customId = String(line.custom_id ?? '');
        if (result.type === 'succeeded') {
          yield { customId, ok: true, message: result.message as Json };
        } else {
          const status = result.type === 'errored' ? 500 : 408;
          yield {
            customId,
            ok: false,
            error: new AiError(status === 408 ? 'TIMEOUT' : 'SERVER_ERROR', 'anthropic', status),
          };
        }
      }
    },
    async purge(batchId) {
      try {
        await client.messages.batches.delete(batchId);
      } catch (error) {
        throw normalizeAiError('anthropic', error);
      }
    },
  };
}
