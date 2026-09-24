import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { toTableData } from '@/lib/read-result';
import { readAdmin } from '@/server/read';
import { userIdFrom } from '../data';
import { UserBriefingsTable } from './user-briefings-table';

/*
 * User › Brifingler (BACKOFFICE_PLAN §6.3c, M§54): the user's briefings (kind, local date, status,
 * timings, item count, AI cost, notification decision, skip reason / error code), never their text.
 * "Yeniden oluştur" applies to today's failed or skipped briefing.
 */
const FILTERS = ['kind', 'status', 'from', 'to'] as const;

export default async function UserBriefingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = await userIdFrom(params);
  const state = loadTableState(await searchParams, FILTERS);
  const result = await readAdmin('GET /users/:id/briefings', {
    params: { id },
    query: toAdminListQuery(state, {
      sortable: ['local_date', 'scheduled_for'],
      filterKeys: FILTERS,
      search: false,
      transform: {
        kind: firstValue,
        status: firstValue,
        from: (values) => values[0],
        to: (values) => values[0],
      },
    }),
  });
  return <UserBriefingsTable data={toTableData(result)} />;
}
