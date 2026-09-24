/**
 * Storage access of the privacy jobs (DATABASE_AND_RLS_PLAN §8; SECURITY_AND_PRIVACY_PLAN §4.5–§4.8).
 * Objects are written and removed only through the Storage API with the secret key: hosted
 * Supabase rejects SQL deletes on `storage.objects`, and a row delete would not remove the blob.
 * Paths are bucket-relative (`{user_id}/…`). Removal runs in batches of 100.
 */
import type { DbClient } from '../../db/clients.ts';
import { AppError } from '../../errors.ts';

export const PRIVATE_BUCKETS = ['captures', 'exports', 'briefing-audio'] as const;
export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

export const REMOVE_BATCH = 100;
const LIST_PAGE = 1000;

export interface ObjectStore {
  upload(bucket: PrivateBucket, path: string, body: Blob, contentType: string): Promise<void>;
  /** Removes the objects (missing ones are ignored); returns how many were removed. */
  remove(bucket: PrivateBucket, paths: readonly string[]): Promise<number>;
  /** Every object path under `prefix` (recursive). */
  list(bucket: PrivateBucket, prefix: string): Promise<string[]>;
  /** A signed download URL valid `expiresInSeconds`. */
  signedUrl(bucket: PrivateBucket, path: string, expiresInSeconds: number): Promise<string>;
}

function storageFailure(operation: string, cause: unknown): AppError {
  return new AppError('SERVICE_UNAVAILABLE', {
    details: { reason: 'storage_unavailable', operation },
    retryable: true,
    cause,
  });
}

/** Removes `paths` in batches of 100 through any store. */
export async function removeInBatches(
  store: ObjectStore,
  bucket: PrivateBucket,
  paths: readonly string[],
): Promise<number> {
  let removed = 0;
  const unique = [...new Set(paths.filter((p) => p !== ''))];
  for (let i = 0; i < unique.length; i += REMOVE_BATCH) {
    removed += await store.remove(bucket, unique.slice(i, i + REMOVE_BATCH));
  }
  return removed;
}

export function supabaseObjectStore(system: DbClient): ObjectStore {
  const bucketOf = (bucket: PrivateBucket) => system.storage.from(bucket);
  return {
    async upload(bucket, path, body, contentType) {
      const { error } = await bucketOf(bucket).upload(path, body, { contentType, upsert: true });
      if (error !== null) throw storageFailure('upload', error);
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return 0;
      const { data, error } = await bucketOf(bucket).remove([...paths]);
      if (error !== null) throw storageFailure('remove', error);
      return Array.isArray(data) ? data.length : 0;
    },
    async list(bucket, prefix) {
      const out: string[] = [];
      const folders = [prefix.replace(/\/+$/, '')];
      while (folders.length > 0) {
        const folder = folders.shift() as string;
        for (let offset = 0; ; offset += LIST_PAGE) {
          const { data, error } = await bucketOf(bucket).list(folder, {
            limit: LIST_PAGE,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          });
          if (error !== null) throw storageFailure('list', error);
          const entries = (data ?? []) as { name: string; id: string | null }[];
          for (const entry of entries) {
            const path = `${folder}/${entry.name}`;
            if (entry.id === null) folders.push(path);
            else out.push(path);
          }
          if (entries.length < LIST_PAGE) break;
        }
      }
      return out;
    },
    async signedUrl(bucket, path, expiresInSeconds) {
      const { data, error } = await bucketOf(bucket).createSignedUrl(path, expiresInSeconds);
      if (error !== null || data === null) throw storageFailure('sign', error);
      return data.signedUrl;
    },
  };
}
