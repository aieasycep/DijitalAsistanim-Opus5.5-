/**
 * Voyage embeddings (R-01, AI_PIPELINE_PLAN §10.3, IMPLEMENTATION_PLAN T-3.10). Raw `fetch`, no SDK.
 * `POST https://api.voyageai.com/v1/embeddings {model, input[≤128], input_type, output_dimension}`.
 * The document and query models come from the `embedding_doc` / `embedding_query` rows of
 * `ai_model_config` (one shared 1024-d space); the vector length is checked against the configured
 * dimension so a wrong model can never write into `vector(1024)`.
 * `VOYAGE_API_KEY` missing → the provider is not constructed (search degrades to FTS only).
 */
import { aiErrorFromHttp, AiError, normalizeAiError } from '../errors.ts';
import type { EmbedParams, EmbedResult, LLMProvider, ModelTarget } from '../types.ts';
import { timeoutMs } from './capabilities.ts';

export const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
export const MAX_VOYAGE_BATCH = 128;

export interface VoyageOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  /** Test-only `VOYAGE_API_BASE_URL` (e.g. `http://127.0.0.1:8788/voyage/v1`); never in preview/production. */
  readonly baseUrl?: string;
}

export function buildVoyageRequest(
  params: EmbedParams,
  target: ModelTarget,
): Record<string, unknown> {
  return {
    model: target.model,
    input: [...params.inputs],
    input_type: target.params.input_type ?? params.kind,
    output_dimension:
      typeof target.params.output_dimension === 'number' ? target.params.output_dimension : 1024,
  };
}

export function createVoyageProvider(options: VoyageOptions): LLMProvider {
  const doFetch = options.fetch ?? fetch;
  const endpoint =
    options.baseUrl === undefined
      ? VOYAGE_ENDPOINT
      : `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  return {
    id: 'voyage',
    async embed(params: EmbedParams, target: ModelTarget): Promise<EmbedResult> {
      if (params.inputs.length === 0) return { vectors: [], usage: { tokens: 0 }, dimensions: 0 };
      if (params.inputs.length > MAX_VOYAGE_BATCH) throw new AiError('BAD_REQUEST', 'voyage');
      const body = buildVoyageRequest(params, target);
      const dims = body.output_dimension as number;
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs(target, 20_000));
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]),
        });
      } catch (error) {
        throw normalizeAiError('voyage', error);
      }
      if (!response.ok) {
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get('Retry-After') ?? 'NaN');
        throw aiErrorFromHttp('voyage', response.status, {
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
        });
      }
      const json = (await response.json()) as {
        data?: { embedding?: number[]; index?: number }[];
        usage?: { total_tokens?: number };
      };
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const vectors = data.map((d) => d.embedding ?? []);
      if (vectors.length !== params.inputs.length || vectors.some((v) => v.length !== dims)) {
        throw new AiError('SCHEMA_VALIDATION', 'voyage');
      }
      return { vectors, usage: { tokens: json.usage?.total_tokens ?? 0 }, dimensions: dims };
    },
  };
}
