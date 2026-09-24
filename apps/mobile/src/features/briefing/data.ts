/**
 * Briefing reads (SCREEN_AND_FLOW_MAP §0.4): `['briefings', id]` = the `briefings` row and its
 * `briefing_items` (live `done_at` overlay, D-12), persisted, 60 s fresh and polled every 5 s while
 * the briefing is scheduled or generating (R-19); `['briefings','list',{cursor}]` = the history,
 * 30 per page by local date. PostgREST as the user, explicit columns.
 */
import { qk } from '@da/api-client';
import { BRIEFING_KIND_VALUES, BRIEFING_STATUS_VALUES } from '@da/domain/enums';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { rpc, toDataError } from '../../lib/postgrest';

export const BriefingRow = z.object({
  id: z.string(),
  kind: z.enum(BRIEFING_KIND_VALUES),
  local_date: z.string(),
  status: z.enum(BRIEFING_STATUS_VALUES),
  origin: z.string().nullable().catch(null),
  headline: z.string().nullable().catch(null),
  narrative: z.string().nullable().catch(null),
  provenance: z.record(z.string(), z.unknown()).nullable().catch(null),
  generated_at: z.string().nullable().catch(null),
  audio_status: z.string().nullable().catch(null),
  audio_duration_s: z.number().nullable().catch(null),
  opened_at: z.string().nullable().catch(null),
  evening_ready_at: z.string().nullable().catch(null),
  counts: z.record(z.string(), z.unknown()).nullable().catch(null),
  weekly_stats: z.record(z.string(), z.unknown()).nullable().catch(null),
  skipped_reason: z.string().nullable().catch(null),
  version: z.number().nullable().catch(null),
});
export type BriefingRow = z.infer<typeof BriefingRow>;

export const BriefingItem = z.object({
  id: z.string(),
  section: z.string(),
  position: z.number(),
  badge: z.string().nullable().catch(null),
  title: z.string(),
  meta: z.string().nullable().catch(null),
  entity_type: z.string().nullable().catch(null),
  entity_id: z.string().nullable().catch(null),
  insight_id: z.string().nullable().catch(null),
  confidence: z.number().catch(1),
  done_at: z.string().nullable().catch(null),
  source_type: z.string().nullable().catch(null),
  source_id: z.string().nullable().catch(null),
});
export type BriefingItem = z.infer<typeof BriefingItem>;

export interface BriefingDetail {
  readonly briefing: BriefingRow;
  readonly items: readonly BriefingItem[];
}

const BRIEFING_COLUMNS =
  'id, kind, local_date, status, origin, headline, narrative, provenance, generated_at, audio_status, audio_duration_s, opened_at, evening_ready_at, counts, weekly_stats, skipped_reason, version';
const ITEM_COLUMNS =
  'id, section, position, badge, title, meta, entity_type, entity_id, insight_id, confidence, done_at, source_type, source_id';

interface Result {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

/** Resolves to null when the briefing does not exist (deleted by retention or never existed). */
export async function fetchBriefing(id: string): Promise<BriefingDetail | null> {
  const supabase = getSupabase();
  const [row, items] = (await Promise.all([
    supabase.from('briefings').select(BRIEFING_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('briefing_items').select(ITEM_COLUMNS).eq('briefing_id', id).order('position'),
  ])) as unknown as [Result, Result];
  if (row.error !== null) throw toDataError(row.error);
  if (items.error !== null) throw toDataError(items.error);
  if (row.data === null) return null;
  const briefing = BriefingRow.parse(row.data);
  const list = Array.isArray(items.data) ? items.data : [];
  return {
    briefing,
    items: list.flatMap((item) => {
      const parsed = BriefingItem.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

export const BRIEFING_POLL_MS = 5_000;

export function briefingQueryOptions(id: string) {
  return queryOptions({
    queryKey: qk.briefings.detail(id),
    queryFn: () => fetchBriefing(id),
    staleTime: 60_000,
    meta: { persist: true },
    refetchInterval: (query) => {
      const status = query.state.data?.briefing.status;
      return status === 'scheduled' || status === 'generating' ? BRIEFING_POLL_MS : false;
    },
  });
}

export function useBriefing(id: string) {
  return useQuery(briefingQueryOptions(id));
}

/** RPC-07 `mark_briefing_opened` (idempotent; first write wins on the server). */
export function markOpened(id: string): Promise<void> {
  return rpc('mark_briefing_opened', { p_briefing_id: id }).then(() => undefined);
}

export const HISTORY_PAGE = 30;

export const HistoryRow = BriefingRow.pick({
  id: true,
  kind: true,
  local_date: true,
  status: true,
  headline: true,
  generated_at: true,
  skipped_reason: true,
});
export type HistoryRow = z.infer<typeof HistoryRow>;

export function historyQueryOptions() {
  return infiniteQueryOptions({
    queryKey: qk.briefings.list(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<readonly HistoryRow[]> => {
      const { data, error } = (await getSupabase()
        .from('briefings')
        .select('id, kind, local_date, status, headline, generated_at, skipped_reason')
        .order('local_date', { ascending: false })
        .order('kind', { ascending: true })
        .range(pageParam, pageParam + HISTORY_PAGE - 1)) as unknown as Result;
      if (error !== null) throw toDataError(error);
      return (Array.isArray(data) ? data : []).flatMap((row) => {
        const parsed = HistoryRow.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
    },
    getNextPageParam: (last, pages) =>
      last.length < HISTORY_PAGE ? undefined : pages.length * HISTORY_PAGE,
    staleTime: 5 * 60_000,
    meta: { persist: true },
  });
}

export function useBriefingHistory() {
  return useInfiniteQuery(historyQueryOptions());
}
