import { AuditTable } from '@/components/audit-table';
import { loadTableState } from '@/components/data-table/url-state';
import { AUDIT_FILTERS, auditQuery } from '@/lib/audit-query';
import { toTableData } from '@/lib/read-result';
import { auditActions } from '@/server/admin-contracts';
import { readAdmin } from '@/server/read';
import { userIdFrom } from '../data';

/*
 * User › Denetim (BACKOFFICE_PLAN §6.3h, M§66): audit rows whose `target_user_id` is this user,
 * newest first, read-only (no edit or delete exists in the UI, the API or SQL).
 */
export default async function UserAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = await userIdFrom(params);
  const state = loadTableState(await searchParams, AUDIT_FILTERS);
  const result = await readAdmin('GET /users/:id/audit', {
    params: { id },
    query: auditQuery(state),
  });
  return (
    <AuditTable
      data={toTableData(result)}
      actions={auditActions()}
      tableId="user.audit"
      userScoped
    />
  );
}
