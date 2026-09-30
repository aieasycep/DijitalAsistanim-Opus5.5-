/**
 * Private Storage access of the AI routes and jobs (DATABASE_AND_RLS_PLAN §8): signed uploads into
 * `captures` (API-CAP-01, API-MAIL-08), 300 s signed reads of `briefing-audio` (API-BRF-01,
 * API-MEET-04), uploads of synthesized audio (JOB-30), capture downloads for the magic-byte check
 * (JOB-27) and deletions after analysis or discard. Always the service client: callers build every
 * path from the verified user id, so a client can never address another user's folder.
 */
import type { DbClient } from '../db/clients.ts';
import { AppError } from '../errors.ts';

export type Bucket = 'captures' | 'briefing-audio';

export interface SignedUpload {
  readonly signedUrl: string;
  readonly token: string;
  readonly path: string;
}

export interface ObjectStorage {
  /** Signed upload URL for one new object (`upsert=false`; valid 2 h). */
  signedUploadUrl(bucket: Bucket, path: string): Promise<SignedUpload>;
  /** Signed read URL valid `expiresIn` seconds. */
  signedUrl(bucket: Bucket, path: string, expiresIn: number): Promise<string>;
  /** Writes (or replaces) an object. */
  upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes (at most `maxBytes`), or null when it does not exist. */
  download(bucket: Bucket, path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Whether an object exists (and its size). */
  stat(bucket: Bucket, path: string): Promise<{ size: number } | null>;
  remove(bucket: Bucket, paths: readonly string[]): Promise<void>;
}

/** Lifetime of a Storage signed upload URL (fixed by Storage). */
export const SIGNED_UPLOAD_TTL_S = 7_200;
/** Signed audio URLs (API-BRF-01, API-MEET-04). */
export const SIGNED_AUDIO_TTL_S = 300;

function storageError(reason: string): AppError {
  return new AppError('SERVICE_UNAVAILABLE', { details: { reason } });
}

function splitPath(path: string): { folder: string; name: string } {
  const at = path.lastIndexOf('/');
  return at === -1
    ? { folder: '', name: path }
    : { folder: path.slice(0, at), name: path.slice(at + 1) };
}

export function supabaseStorage(client: DbClient): ObjectStorage {
  return {
    async signedUploadUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);
      if (error !== null || data === null) throw storageError('signed_upload_failed');
      return { signedUrl: data.signedUrl, token: data.token, path: data.path };
    },
    async signedUrl(bucket, path, expiresIn) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
      if (error !== null || data === null) throw storageError('signed_url_failed');
      return data.signedUrl;
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await client.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error !== null) throw storageError('upload_failed');
    },
    async download(bucket, path, maxBytes) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error !== null || data === null) return null;
      if (data.size > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE');
      return new Uint8Array(await data.arrayBuffer());
    },
    async stat(bucket, path) {
      const { folder, name } = splitPath(path);
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: 10, search: name });
      if (error !== null) throw storageError('list_failed');
      const hit = (data ?? []).find((o) => o.name === name);
      if (hit === undefined) return null;
      const size = Number((hit.metadata as { size?: unknown } | null)?.size ?? 0);
      return { size: Number.isFinite(size) ? size : 0 };
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return;
      const { error } = await client.storage.from(bucket).remove([...paths]);
      if (error !== null) throw storageError('remove_failed');
    },
  };
}
