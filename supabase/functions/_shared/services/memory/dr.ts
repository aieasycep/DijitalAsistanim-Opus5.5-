/**
 * Disaster-recovery embeddings (AI_PIPELINE_PLAN §10.8 step 6, ADR-45, R-01).
 *
 * The `app_settings` key `ai.embedding_dr` (edited in backoffice Settings, audited) holds
 * `{reembed, search, provider:'openai', model, dimensions:1024}`:
 * - `reembed: true` → migration 20260924003300's trigger queues `embedding {mode:'reembed'}`; the
 *   worker re-embeds every chunk that has a primary embedding into `memory_chunks.embedding_dr`
 *   through the DR target, in keyset batches (each batch queues the next), honouring each owner's
 *   Data Source Controls; the job is a system call (no user budget) and every attempt is an
 *   `ai_requests` row;
 * - `search: true` → `memory_vector_candidates` ranks by `embedding_dr` and the api embeds queries
 *   with the same DR target ({@link embedQueryText}), so both sides share one vector space.
 * The model id is data (the setting), never a literal in function code.
 */
import type { ModelTarget } from '../../ai/types.ts';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import { type AiDataAccess, parseAiDataAccess } from '../../policy/data-access.ts';
import type { AiServices, AiUser } from '../ai/runtime.ts';
import type { FlagMap } from '../flags.ts';
import { EMBEDDING_DIMENSIONS, type EmbedOutcome, embedTexts } from './embed.ts';

export const EMBEDDING_DR_SETTING = 'ai.embedding_dr';

export interface EmbeddingDrConfig {
  readonly reembed: boolean;
  readonly search: boolean;
  readonly target: ModelTarget;
}

/** Parses the setting; null when it is absent or malformed (DR off). */
export function parseEmbeddingDr(value: unknown): EmbeddingDrConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.reembed !== 'boolean' ||
    typeof v.search !== 'boolean' ||
    v.provider !== 'openai' ||
    typeof v.model !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(v.model) ||
    v.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    return null;
  }
  return {
    reembed: v.reembed,
    search: v.search,
    target: {
      provider: 'openai',
      model: v.model,
      params: { output_dimension: EMBEDDING_DIMENSIONS, timeout_ms: 20_000 },
    },
  };
}

export interface EmbeddingDrConfigSource {
  get(): Promise<EmbeddingDrConfig | null>;
}

/** Reads `ai.embedding_dr` (short cache so the query model and the SQL column flip together). */
export function supabaseEmbeddingDrConfig(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): EmbeddingDrConfigSource {
  const ttl = options.ttlMs ?? 5_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; value: EmbeddingDrConfig | null } | null = null;
  return {
    async get() {
      if (cache !== null && now() - cache.at < ttl) return cache.value;
      const { data, error } = await client
        .from('app_settings')
        .select('value')
        .eq('key', EMBEDDING_DR_SETTING)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      const value = parseEmbeddingDr((data as { value?: unknown } | null)?.value);
      cache = { at: now(), value };
      return value;
    },
  };
}

/** One chunk still missing its DR vector. */
export interface DrChunk {
  readonly id: string;
  readonly user_id: string;
  readonly chunk_kind: string;
  readonly source_type: string;
  readonly content: string;
}

export interface EmbeddingDrStore extends EmbeddingDrConfigSource {
  /** Chunks with a primary embedding and no DR vector, `id > afterId`, in id order. */
  pending(afterId: string | null, limit: number): Promise<DrChunk[]>;
  /** `user_preferences.ai_data_access` of the owners. */
  access(userIds: readonly string[]): Promise<Map<string, AiDataAccess>>;
  write(rows: readonly { id: string; embedding: readonly number[] }[]): Promise<void>;
  /** The global kill switches (system work has no per-user flags). */
  flags(): Promise<FlagMap>;
}

export function supabaseEmbeddingDrStore(
  client: DbClient,
  flags: () => Promise<FlagMap>,
): EmbeddingDrStore {
  const config = supabaseEmbeddingDrConfig(client, { ttlMs: 0 });
  return {
    get: () => config.get(),
    flags,
    async pending(afterId, limit) {
      let query = client
        .from('memory_chunks')
        .select('id,user_id,chunk_kind,source_type,content')
        .not('embedding', 'is', null)
        .is('embedding_dr', null)
        .order('id', { ascending: true })
        .limit(limit);
      if (afterId !== null) query = query.gt('id', afterId);
      const { data, error } = await query;
      if (error !== null) throw mapDbError(error);
      return (data ?? []) as DrChunk[];
    },
    async access(userIds) {
      const out = new Map<string, AiDataAccess>();
      if (userIds.length === 0) return out;
      const { data, error } = await client
        .from('user_preferences')
        .select('user_id,ai_data_access')
        .in('user_id', [...userIds]);
      if (error !== null) throw mapDbError(error);
      for (const row of (data ?? []) as {
        user_id: string;
        ai_data_access: Record<string, unknown> | null;
      }[]) {
        out.set(row.user_id, parseAiDataAccess(row.ai_data_access));
      }
      return out;
    },
    async write(rows) {
      for (const r of rows) {
        const { error } = await client
          .from('memory_chunks')
          .update({ embedding_dr: `[${r.embedding.join(',')}]` })
          .eq('id', r.id);
        if (error !== null) throw mapDbError(error);
      }
    },
  };
}

/**
 * The query embedding of API-SRCH-01 and the assistant retrieval: the `embedding_query` route, or
 * the DR target while `ai.embedding_dr.search` is on (the SQL vector leg then ranks `embedding_dr`).
 */
export async function embedQueryText(
  ai: AiServices,
  user: AiUser,
  text: string,
  correlationId: string,
): Promise<EmbedOutcome> {
  const dr = ai.embeddingDr === undefined ? null : await ai.embeddingDr.get();
  return await embedTexts(ai.runtime, {
    feature: 'embedding_query',
    userId: user.userId,
    plan: user.plan,
    profile: user.profile,
    flags: user.flags,
    inputs: [text],
    correlationId,
    ...(dr !== null && dr.search ? { target: dr.target } : {}),
  });
}
