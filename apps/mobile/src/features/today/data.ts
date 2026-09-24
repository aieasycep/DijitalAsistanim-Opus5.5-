/**
 * `['today', localDate]` (SCREEN_AND_FLOW_MAP §0.4): RPC-04 `today_overview(p_local_date)` as
 * implemented (API_CONTRACTS §15; the RPC's jsonb is parsed defensively with zod) plus today's and
 * yesterday's `briefings` rows (hero state per kind, the weekly card). Persisted, 30 s fresh,
 * polled every 5 s while a briefing is scheduled or generating (R-19).
 */
import { qk } from '@da/api-client';
import {
  BRIEFING_KIND_VALUES,
  BRIEFING_STATUS_VALUES,
  INSIGHT_KIND_VALUES,
} from '@da/domain/enums';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { rpc, toDataError } from '../../lib/postgrest';

const Source = z.object({
  source_type: z.string().nullable().catch(null),
  source_id: z.string().nullable().catch(null),
  provider: z.string().nullable().catch(null),
  source_timestamp: z.string().nullable().catch(null),
});

export const TodayPriority = z.object({
  id: z.string(),
  kind: z.enum(INSIGHT_KIND_VALUES),
  urgency: z.enum(['urgent', 'today', 'normal', 'low']).nullable().catch(null),
  title: z.string(),
  body: z.string().nullable().catch(null),
  why_important: z.string().nullable().catch(null),
  decision_tier: z.string().nullable().catch(null),
  entity_type: z.string().nullable().catch(null),
  entity_id: z.string().nullable().catch(null),
  due_at: z.string().nullable().catch(null),
  event_at: z.string().nullable().catch(null),
  user_corrected: z.boolean().catch(false),
  source: Source.nullable().catch(null),
});
export type TodayPriority = z.infer<typeof TodayPriority>;

export const TodayOverview = z.object({
  local_date: z.string(),
  time_zone: z.string().catch('Europe/Istanbul'),
  hero_count: z.number().int().catch(0),
  priorities: z.array(TodayPriority).catch([]),
  next_meeting: z
    .object({
      id: z.string(),
      title: z.string(),
      start_at: z.string(),
      end_at: z.string(),
      location: z.string().nullable().catch(null),
      is_online: z.boolean().nullable().catch(null),
      attendee_count: z.number().nullable().catch(null),
      prep_status: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  deadlines: z
    .array(z.object({ insight_id: z.string(), title: z.string(), due_at: z.string().nullable() }))
    .catch([]),
  follow_ups: z
    .array(
      z.object({
        insight_id: z.string(),
        title: z.string(),
        entity_id: z.string().nullable().catch(null),
        due_at: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
  life_intel: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        event_at: z.string().nullable().catch(null),
        due_at: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
  pending_approvals_count: z.number().int().catch(0),
});
export type TodayOverview = z.infer<typeof TodayOverview>;

export const BriefingSummary = z.object({
  id: z.string(),
  kind: z.enum(BRIEFING_KIND_VALUES),
  local_date: z.string(),
  status: z.enum(BRIEFING_STATUS_VALUES),
  origin: z.string().nullable().catch(null),
  headline: z.string().nullable().catch(null),
  generated_at: z.string().nullable().catch(null),
  evening_ready_at: z.string().nullable().catch(null),
  audio_status: z.string().nullable().catch(null),
  audio_duration_s: z.number().nullable().catch(null),
  skipped_reason: z.string().nullable().catch(null),
  weekly_stats: z.record(z.string(), z.unknown()).nullable().catch(null),
});
export type BriefingSummary = z.infer<typeof BriefingSummary>;

export interface TodayData {
  readonly overview: TodayOverview;
  readonly briefings: readonly BriefingSummary[];
}

const BRIEFING_COLUMNS =
  'id, kind, local_date, status, origin, headline, generated_at, evening_ready_at, audio_status, audio_duration_s, skipped_reason, weekly_stats';

export const TODAY_POLL_MS = 5_000;

function yesterdayOf(localDate: string): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function fetchToday(localDate: string): Promise<TodayData> {
  const raw = await rpc('today_overview', { p_local_date: localDate });
  const overview = TodayOverview.parse(raw);
  const { data, error } = (await getSupabase()
    .from('briefings')
    .select(BRIEFING_COLUMNS)
    .in('local_date', [overview.local_date, yesterdayOf(overview.local_date)])
    .order('scheduled_for', { ascending: false })) as {
    data: unknown[] | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  const briefings = (data ?? []).flatMap((row) => {
    const parsed = BriefingSummary.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return { overview, briefings };
}

export function todayQueryOptions(localDate: string) {
  return queryOptions({
    queryKey: qk.today.day(localDate),
    queryFn: () => fetchToday(localDate),
    staleTime: 30_000,
    meta: { persist: true },
    refetchInterval: (query) =>
      (query.state.data?.briefings ?? []).some(
        (b) =>
          b.local_date === localDate && (b.status === 'scheduled' || b.status === 'generating'),
      )
        ? TODAY_POLL_MS
        : false,
  });
}

export function useToday(localDate: string) {
  return useQuery(todayQueryOptions(localDate));
}
