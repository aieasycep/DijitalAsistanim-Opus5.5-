/**
 * HTTP idempotency for `[IK]` routes (API_CONTRACTS §2.11, IMPLEMENTATION_PLAN T-3.03).
 *
 * The client sends `Idempotency-Key: <uuid>` and reuses it for every retry of one intent. The key is
 * stored in `api_idempotency_keys (user_id, key, route, fingerprint, state, response_status,
 * resource_ref, expires_at)`:
 * - new key → run the handler, store `completed` with a content-free `resource_ref`;
 * - same key and fingerprint, `completed` → replay: the route re-renders the current representation
 *   of `resource_ref` with the original status (`Idempotency-Replayed: true`,
 *   `meta.idempotency_replayed`); nothing is written again;
 * - same key, `in_progress` → `409 IDEMPOTENCY_REPLAY {reason:'in_progress'}` + `Retry-After: 1`;
 * - same key, different fingerprint → `409 IDEMPOTENCY_REPLAY {reason:'fingerprint_mismatch'}`;
 * - retryable failures, `424` codes and `REAUTH_REQUIRED` delete the key; other 4xx are stored so a
 *   replay returns the same error.
 */
import { ERROR_HTTP_STATUS, type ErrorCodeValue } from '@da/validation';
import { AppError, fieldError, isAppError, mapDbError } from './errors.ts';
import { sha256 } from './crypto/hmac.ts';
import { fromByteaHex, toByteaHex } from './crypto/encoding.ts';
import type { DbClient } from './db/clients.ts';
import type { AppContext } from './http/context.ts';
import { rawBody } from './http/validate.ts';
import { buildMeta, type MetaExtras } from './http/respond.ts';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Content-free pointer to what a request produced (ids, booleans, counts). */
export interface ResourceRef {
  readonly type: string;
  readonly id?: string;
  /** Small acknowledgement values of routes whose response is not a stored resource. */
  readonly ack?: Record<string, JsonValue>;
  /** A stored deterministic error, replayed as-is. */
  readonly error?: { code: ErrorCodeValue; details?: Record<string, JsonValue> };
}

export interface IdempotencyRecord {
  readonly userId: string;
  readonly key: string;
  readonly route: string;
  readonly fingerprint: Uint8Array;
  readonly state: 'in_progress' | 'completed';
  readonly responseStatus: number | null;
  readonly resourceRef: ResourceRef | null;
  readonly expiresAt: string;
}

export interface IdempotencyRepo {
  /** Inserts an `in_progress` row; `false` when `(user_id, key)` already exists. */
  insert(record: IdempotencyRecord): Promise<boolean>;
  get(userId: string, key: string): Promise<IdempotencyRecord | null>;
  complete(userId: string, key: string, status: number, ref: ResourceRef): Promise<void>;
  remove(userId: string, key: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 24 * 60 * 60 * 1000;

/** Key-sorted JSON so that semantically equal bodies share a fingerprint. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** sha256 of method + route template + canonical JSON body (32 bytes). */
export function requestFingerprint(
  method: string,
  route: string,
  body: unknown,
): Promise<Uint8Array> {
  return sha256(`${method.toUpperCase()} ${route}\n${canonicalJson(body)}`);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Whether a failure frees the key for a retry (§2.11). */
export function releasesKey(error: AppError): boolean {
  return (
    error.retryable ||
    error.status === 424 ||
    error.code === 'REAUTH_REQUIRED' ||
    error.status >= 500
  );
}

export interface IdempotentSpec<T> {
  readonly status: 200 | 201 | 202;
  /** Runs the side effect once and returns the response data plus its resource pointer. */
  execute(): Promise<{ data: T; ref: ResourceRef; meta?: MetaExtras }>;
  /** Re-renders the current representation of a stored pointer (a replay writes nothing). */
  replay(ref: ResourceRef): Promise<T>;
}

export interface IdempotencyOptions {
  readonly repo: IdempotencyRepo;
  readonly now?: () => number;
}

export function idempotencyKey(c: AppContext): string {
  const key = c.req.header('Idempotency-Key')?.trim();
  if (key === undefined || !UUID_RE.test(key))
    throw fieldError('headers.Idempotency-Key', 'invalid_format');
  return key.toLowerCase();
}

function toJsonDetails(
  details: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined {
  if (details === undefined) return undefined;
  return JSON.parse(JSON.stringify(details)) as Record<string, JsonValue>;
}

function replayedResponse(c: AppContext, status: number, data: unknown): Response {
  c.header('Idempotency-Replayed', 'true');
  return c.json({ data, meta: buildMeta(c, { idempotency_replayed: true }) }, status as 200);
}

/** Runs `spec` under the `Idempotency-Key` of the request. Requires `requireUser` first. */
export async function withIdempotency<T>(
  c: AppContext,
  options: IdempotencyOptions,
  spec: IdempotentSpec<T>,
): Promise<Response> {
  const auth = c.get('auth');
  if (auth === undefined)
    throw new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } });
  const key = idempotencyKey(c);
  const route = c.get('routeKey') ?? `${c.req.method} ${c.req.routePath}`;
  const fingerprint = await requestFingerprint(c.req.method, route, rawBody(c));
  const now = options.now ?? Date.now;
  const record: IdempotencyRecord = {
    userId: auth.userId,
    key,
    route,
    fingerprint,
    state: 'in_progress',
    responseStatus: null,
    resourceRef: null,
    expiresAt: new Date(now() + TTL_MS).toISOString(),
  };

  let inserted = await options.repo.insert(record);
  if (!inserted) {
    const existing = await options.repo.get(auth.userId, key);
    if (existing !== null && Date.parse(existing.expiresAt) <= now()) {
      await options.repo.remove(auth.userId, key);
      inserted = await options.repo.insert(record);
    } else if (existing === null) {
      inserted = await options.repo.insert(record);
    }
    if (!inserted) {
      const current = existing ?? (await options.repo.get(auth.userId, key));
      if (current === null)
        throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'idempotency_store' } });
      if (current.route !== route || !sameBytes(current.fingerprint, fingerprint)) {
        throw new AppError('IDEMPOTENCY_REPLAY', { details: { reason: 'fingerprint_mismatch' } });
      }
      if (current.state === 'in_progress' || current.resourceRef === null) {
        throw new AppError('IDEMPOTENCY_REPLAY', {
          details: { reason: 'in_progress' },
          retryable: true,
          headers: { 'Retry-After': '1' },
        });
      }
      c.get('log').info('idempotency_replay', { route });
      const stored = current.resourceRef;
      if (stored.error !== undefined) {
        throw new AppError(stored.error.code, {
          ...(stored.error.details === undefined ? {} : { details: stored.error.details }),
          headers: { 'Idempotency-Replayed': 'true' },
        });
      }
      const data = await spec.replay(stored);
      return replayedResponse(c, current.responseStatus ?? spec.status, data);
    }
  }

  try {
    const result = await spec.execute();
    await options.repo.complete(auth.userId, key, spec.status, result.ref);
    return c.json({ data: result.data, meta: buildMeta(c, result.meta ?? {}) }, spec.status);
  } catch (error) {
    if (isAppError(error) && !releasesKey(error)) {
      await options.repo.complete(auth.userId, key, ERROR_HTTP_STATUS[error.code] ?? error.status, {
        type: 'error',
        error: {
          code: error.code,
          ...(error.details === undefined ? {} : { details: toJsonDetails(error.details) }),
        },
      });
    } else {
      await options.repo.remove(auth.userId, key).catch(() => undefined);
    }
    throw error;
  }
}

// ── supabase-backed repository (`api_idempotency_keys`, service role) ─────────

interface Row {
  user_id: string;
  key: string;
  route: string;
  fingerprint: string;
  state: 'in_progress' | 'completed';
  response_status: number | null;
  resource_ref: ResourceRef | null;
  expires_at: string;
}

function fromRow(row: Row): IdempotencyRecord {
  return {
    userId: row.user_id,
    key: row.key,
    route: row.route,
    fingerprint: fromByteaHex(row.fingerprint),
    state: row.state,
    responseStatus: row.response_status,
    resourceRef: row.resource_ref,
    expiresAt: row.expires_at,
  };
}

export function supabaseIdempotencyRepo(client: DbClient): IdempotencyRepo {
  const table = () => client.from('api_idempotency_keys');
  return {
    async insert(record) {
      const { data, error } = await table()
        .upsert(
          {
            user_id: record.userId,
            key: record.key,
            route: record.route,
            fingerprint: toByteaHex(record.fingerprint),
            state: 'in_progress',
            expires_at: record.expiresAt,
          },
          { onConflict: 'user_id,key', ignoreDuplicates: true },
        )
        .select('key');
      if (error !== null) throw mapDbError(error);
      return Array.isArray(data) && data.length > 0;
    },
    async get(userId, key) {
      const { data, error } = await table()
        .select('user_id,key,route,fingerprint,state,response_status,resource_ref,expires_at')
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return data === null ? null : fromRow(data as Row);
    },
    async complete(userId, key, status, ref) {
      const { error } = await table()
        .update({ state: 'completed', response_status: status, resource_ref: ref })
        .eq('user_id', userId)
        .eq('key', key);
      if (error !== null) throw mapDbError(error);
    },
    async remove(userId, key) {
      const { error } = await table().delete().eq('user_id', userId).eq('key', key);
      if (error !== null) throw mapDbError(error);
    },
  };
}

/** In-memory repository (tests and local tooling). */
export function memoryIdempotencyRepo(): IdempotencyRepo & {
  rows: Map<string, IdempotencyRecord>;
} {
  const rows = new Map<string, IdempotencyRecord>();
  const id = (userId: string, key: string) => `${userId}:${key}`;
  return {
    rows,
    insert(record) {
      const k = id(record.userId, record.key);
      if (rows.has(k)) return Promise.resolve(false);
      rows.set(k, record);
      return Promise.resolve(true);
    },
    get(userId, key) {
      return Promise.resolve(rows.get(id(userId, key)) ?? null);
    },
    complete(userId, key, status, ref) {
      const k = id(userId, key);
      const row = rows.get(k);
      if (row !== undefined)
        rows.set(k, { ...row, state: 'completed', responseStatus: status, resourceRef: ref });
      return Promise.resolve();
    },
    remove(userId, key) {
      rows.delete(id(userId, key));
      return Promise.resolve();
    },
  };
}
