/**
 * Audit rows for Edge-side admin operations (BACKOFFICE_PLAN §2.5 step 10, §2.6, §10;
 * API_CONTRACTS §12.1). SQL mutations append their own audit row in the same transaction; the
 * operations that run outside SQL (Auth admin calls, the model probe, the prompt dry run, the
 * `health` run, partial failures) end with `admin_api.audit_write(...)`, `result` ∈
 * `success | failure | denied`, replay-safe on the idempotency key. A partial outcome is a
 * `failure` row with `details.partial = true`.
 */
import type { AdminDb } from '../lib/db.ts';

export interface AuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly targetUserId?: string | null;
  readonly reason: string;
  readonly result: 'success' | 'failure' | 'denied';
  readonly details?: Record<string, unknown>;
  /** The request's `Idempotency-Key`: a replay finds the earlier row instead of adding one. */
  readonly idempotencyKey?: string | null;
}

/** Appends one audit row; returns its id. */
export async function auditWrite(db: AdminDb, entry: AuditEntry): Promise<number> {
  return await db.call<number>('audit_write', {
    p_action: entry.action,
    p_target_type: entry.targetType,
    p_target_id: entry.targetId,
    p_target_user_id: entry.targetUserId ?? null,
    p_reason: entry.reason,
    p_result: entry.result,
    p_details: entry.details ?? {},
    p_idem: entry.idempotencyKey ?? null,
  });
}

/**
 * The SQL gate for Edge-side operations: `admin_api.authorize(permission)` re-checks the permission
 * and the live session and counts the mutation-class rate limit before any service-role call.
 */
export async function authorize(db: AdminDb, permission: string): Promise<void> {
  await db.call('authorize', { p_permission: permission });
}
