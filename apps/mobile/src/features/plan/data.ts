/**
 * Plan data (M-PLAN-01/02): RPC-09 `plan_range` (events, tasks, commitments, life events,
 * deadlines and pending DA blocks merged server-side), RPC-18 `plan_week_density`, the open
 * Calendar Intelligence insights, client-side gaps (≥ 60 min inside working hours) and the
 * proposal helpers: `POST /plan/proposals` seeds `['approvals', id]` with the server's view so the
 * proposal sheet renders the exact change at once.
 */
import { qk } from '@da/api-client';
import { callRoute } from '@da/api-client/react';
import type { ApiClient } from '@da/api-client';
import {
  addDaysToLocalDate,
  isoWeekdayOf,
  startOfLocalDay,
  zonedWallTimeToInstant,
} from '@da/domain';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { callRpc, unwrap } from '../../lib/data/rpc';
import type { ApprovalDetail } from '../approvals/view';

export const PlanItem = z.object({
  item_type: z.enum(['event', 'task', 'commitment', 'life_event', 'deadline', 'proposal']),
  id: z.string(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  all_day: z.boolean().nullable().optional(),
  title: z.string().nullable(),
  status: z.string().nullable().optional(),
  is_online: z.boolean().nullable().optional(),
  attendee_count: z.number().nullable().optional(),
  created_by_assistant: z.boolean().nullable().optional(),
  direction: z.string().nullable().optional(),
  life_event_type: z.string().nullable().optional(),
  insight_id: z.string().nullable().optional(),
  approval_status: z.string().nullable().optional(),
  action_type: z.string().nullable().optional(),
  source: z
    .object({
      source_type: z.string().nullable(),
      source_id: z.string().nullable(),
      provider: z.string().nullable(),
    })
    .partial()
    .nullable()
    .optional(),
});
export type PlanItemRow = z.infer<typeof PlanItem>;

const PlanRange = z.object({ items: z.array(PlanItem) });

export function planRangeOptions(fromIso: string, toIso: string) {
  return queryOptions({
    queryKey: qk.plan.timeline(fromIso, toIso),
    queryFn: async () =>
      PlanRange.parse(await callRpc('plan_range', { p_from: fromIso, p_to: toIso })).items,
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export const DensityRow = z.object({
  local_date: z.string(),
  meeting_minutes: z.number(),
  focus_minutes: z.number(),
  event_count: z.number(),
  is_hot: z.boolean(),
  is_today: z.boolean(),
});
export type DensityRowData = z.infer<typeof DensityRow>;

export function weekDensityOptions(weekStart: string) {
  return queryOptions({
    queryKey: qk.plan.week(weekStart),
    queryFn: async () =>
      z
        .array(DensityRow)
        .parse((await callRpc('plan_week_density', { p_week_start: weekStart })) ?? []),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export type Signal =
  'conflict' | 'schedule_suggestion' | 'prep_needed' | 'back_to_back' | 'leave_by' | 'deadline';

export interface SignalRow {
  readonly id: string;
  readonly signal: Signal;
  readonly title: string;
  readonly body: string | null;
  readonly at: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly sourceType: string;
  readonly sourceId: string;
}

const SEVERITY: readonly Signal[] = [
  'conflict',
  'deadline',
  'back_to_back',
  'prep_needed',
  'leave_by',
  'schedule_suggestion',
];

/** Day card priority: conflict > schedule_suggestion > prep_needed > back_to_back > leave_by. */
const DAY_PRIORITY: readonly Signal[] = [
  'conflict',
  'schedule_suggestion',
  'prep_needed',
  'back_to_back',
  'leave_by',
];

function signalOf(kind: string, reason: string): Signal | null {
  if (kind === 'conflict') return 'conflict';
  if (kind === 'schedule_suggestion') return 'schedule_suggestion';
  if (kind === 'deadline') return 'deadline';
  if (
    kind === 'meeting' &&
    (reason === 'back_to_back' || reason === 'prep_needed' || reason === 'leave_by')
  ) {
    return reason;
  }
  return null;
}

/** Open Calendar Intelligence insights whose time falls in the range. */
export function signalsOptions(fromIso: string, toIso: string) {
  return queryOptions({
    queryKey: qk.plan.signals(fromIso, toIso),
    queryFn: async (): Promise<SignalRow[]> => {
      const rows = unwrap(
        await getSupabase()
          .from('insights')
          .select(
            'id,kind,reason_code,title,body,due_at,event_at,entity_type,entity_id,source_type,source_id',
          )
          .eq('status', 'open')
          .in('kind', ['conflict', 'schedule_suggestion', 'meeting', 'deadline'])
          .order('created_at', { ascending: false })
          .limit(100),
      );
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      return rows.flatMap((r) => {
        const signal = signalOf(r.kind, r.reason_code);
        const at = r.event_at ?? r.due_at;
        if (signal === null) return [];
        if (at !== null && (Date.parse(at) < from || Date.parse(at) >= to)) return [];
        if (at === null && signal !== 'schedule_suggestion') return [];
        return [
          {
            id: r.id,
            signal,
            title: r.title,
            body: r.body,
            at,
            entityType: r.entity_type,
            entityId: r.entity_id,
            sourceType: r.source_type,
            sourceId: r.source_id,
          },
        ];
      });
    },
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export function bySeverity(rows: readonly SignalRow[]): SignalRow[] {
  return [...rows].sort((a, b) => SEVERITY.indexOf(a.signal) - SEVERITY.indexOf(b.signal));
}

export function topDaySignal(rows: readonly SignalRow[]): SignalRow | null {
  const ranked = rows
    .filter((r) => DAY_PRIORITY.includes(r.signal))
    .sort((a, b) => DAY_PRIORITY.indexOf(a.signal) - DAY_PRIORITY.indexOf(b.signal));
  return ranked[0] ?? null;
}

// ── dates and gaps ──────────────────────────────────────────────────────────────────────

export function dayRange(date: string, timeZone: string): { from: string; to: string } {
  return {
    from: startOfLocalDay(date, timeZone).toISOString(),
    to: startOfLocalDay(addDaysToLocalDate(date, 1), timeZone).toISOString(),
  };
}

export function weekStartOf(date: string): string {
  return addDaysToLocalDate(date, 1 - isoWeekdayOf(date));
}

export function weekDays(date: string): string[] {
  const start = weekStartOf(date);
  return Array.from({ length: 7 }, (_, i) => addDaysToLocalDate(start, i));
}

export interface Gap {
  readonly start: string;
  readonly end: string;
  readonly minutes: number;
}

export const MIN_GAP_MINUTES = 60;

/** Free windows ≥ 60 min between busy timed items, inside working hours on work days. */
export function computeGaps(input: {
  readonly date: string;
  readonly timeZone: string;
  readonly items: readonly PlanItemRow[];
  readonly workStart: string;
  readonly workEnd: string;
  readonly workDays: readonly number[];
  readonly nowMs: number;
}): Gap[] {
  if (!input.workDays.includes(isoWeekdayOf(input.date))) return [];
  const dayStart = zonedWallTimeToInstant(
    input.date,
    input.workStart.slice(0, 5),
    input.timeZone,
  ).getTime();
  const dayEnd = zonedWallTimeToInstant(
    input.date,
    input.workEnd.slice(0, 5),
    input.timeZone,
  ).getTime();
  const busy = input.items
    .filter(
      (i) =>
        (i.item_type === 'event' || i.item_type === 'proposal') &&
        i.all_day !== true &&
        i.start_at !== null &&
        i.end_at !== null,
    )
    .map((i) => [Date.parse(i.start_at ?? ''), Date.parse(i.end_at ?? '')] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Gap[] = [];
  let cursor = Math.max(dayStart, input.nowMs);
  for (const [start, end] of busy) {
    if (start > cursor) {
      const gapEnd = Math.min(start, dayEnd);
      const minutes = Math.floor((gapEnd - cursor) / 60_000);
      if (minutes >= MIN_GAP_MINUTES) {
        gaps.push({
          start: new Date(cursor).toISOString(),
          end: new Date(gapEnd).toISOString(),
          minutes,
        });
      }
    }
    cursor = Math.max(cursor, end);
    if (cursor >= dayEnd) break;
  }
  if (dayEnd > cursor) {
    const minutes = Math.floor((dayEnd - cursor) / 60_000);
    if (minutes >= MIN_GAP_MINUTES) {
      gaps.push({
        start: new Date(cursor).toISOString(),
        end: new Date(dayEnd).toISOString(),
        minutes,
      });
    }
  }
  return gaps;
}

// ── proposals ───────────────────────────────────────────────────────────────────────────

export interface ProposalInput {
  readonly item?: {
    readonly type: 'task' | 'commitment' | 'insight' | 'email_message';
    readonly id: string;
  };
  readonly title?: string;
  readonly durationMinutes: number;
  readonly window: { readonly from: string; readonly to: string };
}

/** `POST /plan/proposals` and seed the proposal sheet's cache; returns the approval id. */
export async function createProposal(
  client: ApiClient,
  queryClient: QueryClient,
  input: ProposalInput,
): Promise<string> {
  const response = await callRoute(client, 'POST /plan/proposals', {
    body: {
      ...(input.item === undefined ? {} : { item: input.item }),
      ...(input.title === undefined ? {} : { title: input.title.slice(0, 300) }),
      duration_minutes: Math.min(480, Math.max(15, Math.round(input.durationMinutes))),
      window: input.window,
    },
  });
  const detail: ApprovalDetail = {
    view: response.approval,
    time: { start: response.slot.start, end: response.slot.end },
    title: input.title ?? null,
  };
  queryClient.setQueryData(qk.approvals.detail(response.approval.id), detail);
  return response.approval.id;
}
