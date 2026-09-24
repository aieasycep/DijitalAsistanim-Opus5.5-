/**
 * OpenAI adapter (AI_PIPELINE_PLAN §3.2, §15.3; IMPLEMENTATION_PLAN T-3.10). Official SDK only.
 *
 * - Structured output: `responses.parse` with a strict `json_schema` text format
 *   (`zodTextFormat`), for the configured fallback models; `output_parsed` null → `SCHEMA_VALIDATION`,
 *   a `refusal` output item → `REFUSAL`.
 * - `reasoning.effort` only when the target params carry it; `safety_identifier` = HMAC(user).
 * - Grounded answers for fallback providers without native citations go through
 *   `generateStructured` with `AssistantGroundedJsonV1` (server-verified quotes).
 * - Embeddings: the disaster-recovery re-embed path with `dimensions` from the target params
 *   (1024 to stay in the `vector(1024)` column; R-01).
 * SDK retries are disabled; `OPENAI_API_KEY` missing → the provider is not constructed.
 */
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { AiError, normalizeAiError } from '../errors.ts';
import { maxOutputTokens } from '../pricing.ts';
import type {
  EmbedParams,
  EmbedResult,
  GenerateStructuredParams,
  GenerateStructuredResult,
  LLMProvider,
  ModelTarget,
  NormalizedUsage,
} from '../types.ts';
import { samplingAllowed, sendEffort, timeoutMs } from './capabilities.ts';

export interface OpenAIOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseURL?: string;
  readonly now?: () => number;
}

type Json = Record<string, unknown>;

export function openaiClient(options: OpenAIOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    maxRetries: 0,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });
}

export function openaiUsage(usage: Json | null | undefined): NormalizedUsage {
  const u = (usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  };
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** OpenAI strict schemas need a name matching `^[a-zA-Z0-9_-]{1,64}$`. */
function formatName(schemaName: string): string {
  return schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** The complete `responses.parse` body (exported for request-shape tests). */
export function buildResponsesRequest<T>(
  params: GenerateStructuredParams<T>,
  target: ModelTarget,
): Json {
  const user: Json[] = [];
  const prompt = params.prompt;
  if (prompt.userContext !== undefined && prompt.userContext !== '')
    user.push({ type: 'input_text', text: prompt.userContext });
  for (const image of prompt.images ?? []) {
    user.push({
      type: 'input_image',
      image_url: `data:${image.mime};base64,${image.b64}`,
      detail: 'auto',
    });
  }
  if (prompt.pdf !== undefined) {
    user.push({
      type: 'input_file',
      filename: `${prompt.pdf.ref}.pdf`,
      file_data: `data:application/pdf;base64,${prompt.pdf.b64}`,
    });
  }
  if (prompt.untrusted !== undefined && prompt.untrusted !== '')
    user.push({ type: 'input_text', text: prompt.untrusted });
  if (prompt.instruction !== undefined && prompt.instruction !== '')
    user.push({ type: 'input_text', text: prompt.instruction });
  const request: Json = {
    model: target.model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: prompt.system }] },
      { role: 'user', content: user },
    ],
    text: {
      format: zodTextFormat(params.schema as unknown as z.ZodType, formatName(params.schemaName)),
    },
    max_output_tokens: maxOutputTokens(target),
    store: false,
  };
  const effort = sendEffort(target);
  if (effort !== undefined) request.reasoning = { effort };
  if (samplingAllowed(target) && typeof target.params.temperature === 'number')
    request.temperature = target.params.temperature;
  if (params.userRef !== null) request.safety_identifier = params.userRef;
  return request;
}

export function createOpenAIProvider(options: OpenAIOptions): LLMProvider {
  const client = openaiClient(options);
  const now = options.now ?? Date.now;
  return {
    id: 'openai',
    async generateStructured<T>(
      params: GenerateStructuredParams<T>,
      target: ModelTarget,
    ): Promise<GenerateStructuredResult<T>> {
      const started = now();
      let response: {
        output_parsed?: unknown;
        output?: { type?: string; content?: { type?: string }[] }[];
        usage?: Json;
        status?: string;
        incomplete_details?: { reason?: string } | null;
        _request_id?: string | null;
      };
      try {
        response = (await client.responses.parse(buildResponsesRequest(params, target) as never, {
          timeout: timeoutMs(target),
          ...(params.signal === undefined ? {} : { signal: params.signal }),
        })) as unknown as typeof response;
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        const name = (error as { name?: string }).name ?? '';
        if (
          typeof status !== 'number' &&
          ['SyntaxError', 'ZodError', 'OpenAIError'].includes(name)
        ) {
          throw new AiError('SCHEMA_VALIDATION', 'openai');
        }
        throw normalizeAiError('openai', error);
      }
      const usage = openaiUsage(response.usage);
      const requestId = response._request_id ?? undefined;
      const refused = (response.output ?? []).some((item) =>
        (item.content ?? []).some((c) => c.type === 'refusal'),
      );
      if (refused)
        return {
          data: undefined as unknown as T,
          usage,
          stopReason: 'refusal',
          latencyMs: now() - started,
          ...(requestId === undefined ? {} : { requestId }),
        };
      if (
        response.status === 'incomplete' &&
        response.incomplete_details?.reason === 'max_output_tokens'
      ) {
        return {
          data: undefined as unknown as T,
          usage,
          stopReason: 'max_tokens',
          latencyMs: now() - started,
          ...(requestId === undefined ? {} : { requestId }),
        };
      }
      if (response.output_parsed === null || response.output_parsed === undefined)
        throw new AiError('SCHEMA_VALIDATION', 'openai');
      const parsed = params.schema.safeParse(response.output_parsed);
      if (!parsed.success) throw new AiError('SCHEMA_VALIDATION', 'openai');
      return {
        data: parsed.data,
        usage,
        stopReason: 'end',
        latencyMs: now() - started,
        ...(requestId === undefined ? {} : { requestId }),
      };
    },
    async embed(params: EmbedParams, target: ModelTarget): Promise<EmbedResult> {
      const dims =
        typeof target.params.output_dimension === 'number' ? target.params.output_dimension : 1024;
      try {
        const response = await client.embeddings.create(
          {
            model: target.model,
            input: [...params.inputs],
            dimensions: dims,
            encoding_format: 'float',
          },
          {
            timeout: timeoutMs(target, 20_000),
            ...(params.signal === undefined ? {} : { signal: params.signal }),
          },
        );
        const vectors = [...response.data]
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        if (vectors.some((v) => v.length !== dims))
          throw new AiError('SCHEMA_VALIDATION', 'openai');
        return { vectors, usage: { tokens: response.usage.total_tokens }, dimensions: dims };
      } catch (error) {
        throw normalizeAiError('openai', error);
      }
    },
  };
}
