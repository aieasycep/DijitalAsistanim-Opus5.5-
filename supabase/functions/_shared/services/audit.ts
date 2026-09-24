/**
 * Audit writer (API_CONTRACTS §17, DATABASE_AND_RLS_PLAN §6.7): appends to the hash-chained
 * `audit_logs` through `public.audit_log_append(...)` (the service-role wrapper of
 * `private.audit_log_append`). Details are ids and codes only, never content or tokens.
 */
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';

export interface AuditEntry {
  readonly actorType: 'user' | 'admin' | 'system';
  readonly actorId: string | null;
  readonly actorRole?: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly targetUserId: string | null;
  readonly reason?: string | null;
  readonly result: 'success' | 'failure' | 'denied';
  readonly details?: Record<string, string | number | boolean | null>;
  readonly correlationId: string | null;
}

export interface AuditWriter {
  append(entry: AuditEntry): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseAuditWriter(system: DbClient): AuditWriter {
  return {
    async append(entry) {
      await rpc<number>(system, DB_FN.auditLogAppend, {
        p_actor_type: entry.actorType,
        p_actor_id: entry.actorId,
        p_actor_role: entry.actorRole ?? null,
        p_action: entry.action,
        p_target_type: entry.targetType,
        p_target_id: entry.targetId,
        p_target_user_id: entry.targetUserId,
        p_reason: entry.reason ?? null,
        p_result: entry.result,
        p_details: entry.details ?? {},
        p_correlation_id:
          entry.correlationId !== null && UUID_RE.test(entry.correlationId)
            ? entry.correlationId
            : null,
        p_ip_hash: null,
      });
    },
  };
}
