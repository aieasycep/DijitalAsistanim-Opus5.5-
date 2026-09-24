/**
 * `Idempotency-Key` for admin mutations (API_CONTRACTS §12.1, §2.11; BACKOFFICE_PLAN §2.5 step 9).
 *
 * Every POST/PATCH/DELETE carries a uuid key. For an admin identity the key is stored in
 * `api_idempotency_keys` under the admin's user id (service role), fingerprinted over the method,
 * the concrete path and the canonical body:
 * - a new key runs the handler and stores its response data (content-free: ids, states, masked
 *   labels); a replay answers the stored data with `Idempotency-Replayed: true` and
 *   `meta.idempotency_replayed = true`, writing nothing;
 * - routes whose response carries a one-time secret or revealed PII (`replay: 'refuse'`) keep only
 *   a marker, and a reused key answers `409 IDEMPOTENCY_REPLAY {reason:'not_replayable'}`;
 * - `in_progress` → 409 `{reason:'in_progress'}`; another body with the same key → 409
 *   `{reason:'fingerprint_mismatch'}`; retryable failures release the key, others are stored.
 * The BFF sign-in routes have no admin identity yet: their key is validated, not stored.
 */
import { ERROR_HTTP_STATUS } from '@da/validation';
import { AppError, isAppError } from '../../_shared/errors.ts';
import {
  type IdempotencyRecord,
  type IdempotencyRepo,
  type JsonValue,
  releasesKey,
  requestFingerprint,
} from '../../_shared/idempotency.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import type { RouteResult } from '../lib/route.ts';

const TTL_MS = 24 * 60 * 60 * 1000;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export interface IdempotentRun {
  readonly repo: IdempotencyRepo;
  readonly adminId: string;
  readonly key: string;
  /** Route template (`"POST /users/:id/disable"`), stored in `route` (≤ 120 chars). */
  readonly routeKey: string;
  readonly method: string;
  /** Concrete request path, part of the fingerprint so one key cannot hit two targets. */
  readonly path: string;
  readonly body: unknown;
  readonly replay: 'store' | 'refuse';
  readonly log: Logger;
  readonly now: () => number;
}

export interface IdempotentOutcome {
  readonly result: RouteResult;
  readonly replayed: boolean;
}

export async function runIdempotent(
  run: IdempotentRun,
  execute: () => Promise<RouteResult>,
): Promise<IdempotentOutcome> {
  const fingerprint = await requestFingerprint(run.method, run.path, run.body);
  const record: IdempotencyRecord = {
    userId: run.adminId,
    key: run.key,
    route: run.routeKey.slice(0, 120),
    fingerprint,
    state: 'in_progress',
    responseStatus: null,
    resourceRef: null,
    expiresAt: new Date(run.now() + TTL_MS).toISOString(),
  };

  let inserted = await run.repo.insert(record);
  if (!inserted) {
    const existing = await run.repo.get(run.adminId, run.key);
    if (existing === null || Date.parse(existing.expiresAt) <= run.now()) {
      if (existing !== null) await run.repo.remove(run.adminId, run.key);
      inserted = await run.repo.insert(record);
    }
    if (!inserted) {
      const current = existing ?? (await run.repo.get(run.adminId, run.key));
      if (current === null) {
        throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'idempotency_store' } });
      }
      if (current.route !== record.route || !sameBytes(current.fingerprint, fingerprint)) {
        throw new AppError('IDEMPOTENCY_REPLAY', { details: { reason: 'fingerprint_mismatch' } });
      }
      if (current.state === 'in_progress' || current.resourceRef === null) {
        throw new AppError('IDEMPOTENCY_REPLAY', {
          details: { reason: 'in_progress' },
          retryable: true,
          headers: { 'Retry-After': '1' },
        });
      }
      const stored = current.resourceRef;
      if (stored.error !== undefined) {
        throw new AppError(stored.error.code, {
          ...(stored.error.details === undefined ? {} : { details: stored.error.details }),
          headers: { 'Idempotency-Replayed': 'true' },
        });
      }
      const ack = stored.ack;
      if (stored.type !== 'admin_response' || ack === undefined) {
        throw new AppError('IDEMPOTENCY_REPLAY', { details: { reason: 'not_replayable' } });
      }
      run.log.info('idempotency_replay', { route: run.routeKey });
      const page = ack.page as RouteResult['page'] | null | undefined;
      return {
        replayed: true,
        result: {
          data: ack.data,
          ...(page === null || page === undefined ? {} : { page }),
          status: (current.responseStatus ?? 200) as 200 | 201 | 202,
        },
      };
    }
  }

  try {
    const result = await execute();
    const status = result.status ?? 200;
    await run.repo.complete(
      run.adminId,
      run.key,
      status,
      run.replay === 'refuse'
        ? { type: 'admin_one_time' }
        : {
            type: 'admin_response',
            ack: { data: toJson(result.data), page: toJson(result.page ?? null) },
          },
    );
    return { result, replayed: false };
  } catch (error) {
    if (isAppError(error) && !releasesKey(error)) {
      await run.repo.complete(run.adminId, run.key, ERROR_HTTP_STATUS[error.code] ?? error.status, {
        type: 'error',
        error: {
          code: error.code,
          ...(error.details === undefined
            ? {}
            : { details: toJson(error.details) as Record<string, JsonValue> }),
        },
      });
    } else {
      await run.repo.remove(run.adminId, run.key).catch(() => undefined);
    }
    throw error;
  }
}
