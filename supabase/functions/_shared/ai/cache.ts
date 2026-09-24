/**
 * AI result cache (R-02, AI_PIPELINE_PLAN §8.4, IMPLEMENTATION_PLAN T-3.09).
 *
 * `ai_result_cache` is keyed by `(user_id, feature, content_hash, prompt_version_id)`.
 * `k_user = HMAC-SHA256(AI_HASH_PEPPER, user_id)` is derived at runtime and never stored;
 * `content_hash = HMAC-SHA256(k_user, foldTR(normTR(content)))`, so equal content of two users never
 * yields the same hash (no cross-user correlation). Only validated, grounded results are stored.
 */
import { foldTR, normalizeTR } from '@da/domain';
import type { AiFeature } from '@da/domain';
import { hmacSha256 } from '../crypto/hmac.ts';
import { fromByteaHex, toByteaHex, toHex } from '../crypto/encoding.ts';
import type { DbClient } from '../db/clients.ts';
import { mapDbError } from '../errors.ts';
import type { Json } from '../jobs/types.ts';

/** Per-user HMAC content hash (32 bytes). */
export async function contentHash(
  aiHashPepper: string,
  userId: string,
  content: string,
): Promise<Uint8Array> {
  const userKey = await hmacSha256(aiHashPepper, userId);
  return hmacSha256(userKey, foldTR(normalizeTR(content)));
}

/** HMAC pseudonym sent to providers (`metadata.user_id` / `safety_identifier`). */
export async function providerUserRef(aiHashPepper: string, userId: string): Promise<string> {
  return toHex(await hmacSha256(aiHashPepper, `provider:${userId}`)).slice(0, 32);
}

export interface CacheKey {
  readonly userId: string;
  readonly feature: AiFeature;
  readonly contentHash: Uint8Array;
  readonly promptVersionId: string;
}

export interface CachedResult {
  readonly result: Json;
  readonly model: string;
}

export interface ResultCache {
  get(key: CacheKey): Promise<CachedResult | null>;
  put(key: CacheKey, value: CachedResult): Promise<void>;
}

export function supabaseResultCache(client: DbClient, now: () => number = Date.now): ResultCache {
  const table = () => client.from('ai_result_cache');
  return {
    async get(key) {
      const { data, error } = await table()
        .select('id,result,model,hit_count,expires_at')
        .eq('user_id', key.userId)
        .eq('feature', key.feature)
        .eq('content_hash', toByteaHex(key.contentHash))
        .eq('prompt_version_id', key.promptVersionId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      if (data === null) return null;
      const row = data as {
        id: string;
        result: Json;
        model: string;
        hit_count: number;
        expires_at: string | null;
      };
      if (row.expires_at !== null && Date.parse(row.expires_at) <= now()) return null;
      const { error: updateError } = await table()
        .update({ hit_count: row.hit_count + 1, last_hit_at: new Date(now()).toISOString() })
        .eq('id', row.id);
      if (updateError !== null) throw mapDbError(updateError);
      return { result: row.result, model: row.model };
    },
    async put(key, value) {
      const { error } = await table().upsert(
        {
          user_id: key.userId,
          feature: key.feature,
          content_hash: toByteaHex(key.contentHash),
          prompt_version_id: key.promptVersionId,
          model: value.model,
          result: value.result,
        },
        { onConflict: 'user_id,feature,content_hash,prompt_version_id', ignoreDuplicates: true },
      );
      if (error !== null) throw mapDbError(error);
    },
  };
}

/** Decodes a `bytea` content hash read back from PostgREST. */
export function decodeContentHash(value: string): Uint8Array {
  return fromByteaHex(value);
}
