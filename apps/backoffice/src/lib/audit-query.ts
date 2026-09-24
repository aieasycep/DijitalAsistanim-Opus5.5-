import {
  dayBound,
  firstValue,
  toAdminListQuery,
  type TableUrlState,
} from '@/components/data-table/url-state';

/** `AuditListQuery` filters (BACKOFFICE_PLAN §6.20); the order is `ts` desc, append-only. */
export const AUDIT_FILTERS = [
  'action',
  'result',
  'actor_role',
  'actor_id',
  'target_type',
  'target_id',
  'from',
  'to',
] as const;

export function auditQuery(state: TableUrlState): Record<string, string | number | undefined> {
  return toAdminListQuery(state, {
    sortable: ['ts'],
    filterKeys: AUDIT_FILTERS,
    search: false,
    transform: {
      action: firstValue,
      result: firstValue,
      actor_role: firstValue,
      actor_id: firstValue,
      target_type: firstValue,
      target_id: firstValue,
      from: dayBound('from'),
      to: dayBound('to'),
    },
  });
}
