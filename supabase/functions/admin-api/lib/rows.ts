/** Row mappers shared by several admin modules (audit rows, grants, integration resources). */
import { actorLabel, auditIdToUuid, type Json, str } from './map.ts';

/** `private.audit_row_json` → the ADM-17 list row (`GET /audit`, `GET /users/:id/audit`). */
export function auditListRow(r: Json) {
  const targetType = str(r.target_type);
  const targetId = str(r.target_id);
  return {
    id: auditIdToUuid(r.id),
    ts: r.ts,
    actor: actorLabel(r.actor_type, r.actor),
    role: str(r.role),
    action: r.action,
    target:
      targetType === null ? targetId : targetId === null ? targetType : `${targetType}:${targetId}`,
    reason: str(r.reason),
    result: r.result,
    correlation_id: str(r.correlation_id),
  };
}

/** `sync_states.resource` → the contract's `mail | calendar | tasks`. */
export function resourceKind(resource: unknown): 'mail' | 'calendar' | 'tasks' | null {
  const r = str(resource) ?? '';
  if (r === 'gmail_mailbox' || r.startsWith('graph_mail')) return 'mail';
  if (r.includes('calendar')) return 'calendar';
  if (r === 'google_tasks' || r === 'todo_list' || r === 'device_reminders') return 'tasks';
  return null;
}

/** Grant state from its dates (`private` uses the same rule). */
export function grantState(g: Json, nowMs: number): 'active' | 'scheduled' | 'ended' | 'revoked' {
  if (g.revoked_at !== null && g.revoked_at !== undefined) return 'revoked';
  const starts = Date.parse(str(g.starts_at) ?? '');
  const ends = Date.parse(str(g.ends_at) ?? '');
  if (Number.isFinite(starts) && starts > nowMs) return 'scheduled';
  if (Number.isFinite(ends) && ends <= nowMs) return 'ended';
  return 'active';
}
