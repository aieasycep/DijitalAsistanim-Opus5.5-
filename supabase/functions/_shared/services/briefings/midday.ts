/**
 * Midday pulse (IMPLEMENTATION_PLAN T-5.08; R-05; AI_PIPELINE_PLAN §4.3.8; M§10).
 *
 * A deterministic T0 composition of what changed since the morning briefing: new urgent reply
 * requests, new conflicts, deadlines due today, changed or cancelled events of today. The payload
 * is `MiddayPulseV1` (validated before persistence). Zero meaningful delta → `skipped` with
 * `skipped_reason='no_meaningful_delta'` and no push; otherwise "Sabahından beri {n} önemli
 * gelişme oldu.". The optional one-sentence T1 polish runs only behind `ai.feature.briefing_polish`.
 */
import { atLocalTime, localDate, localDateDiffDays } from '@da/domain';
import { MiddayPulseV1, refineMiddayPulseV1 } from '@da/validation';
import type { PipelineContext } from '../ai/pipeline.ts';
import { clip, copy, formatTime } from '../copy.ts';
import type {
  BriefingRow,
  CalendarEventRow,
  InsightRow,
} from '../intel/types.ts';
import { briefingNotification, fromEvent, fromInsight, type ItemDraft, itemRows } from './items.ts';
import type { ComposedBriefing } from './morning.ts';
import { polishDrafts } from './polish.ts';

export interface MiddayInput {
  readonly briefing: BriefingRow;
  readonly morning: BriefingRow | null;
  readonly now: Date;
  readonly insights: readonly InsightRow[];
  readonly events: readonly CalendarEventRow[];
}

type DeltaType = MiddayPulseV1['deltas'][number]['type'];
type DeltaBadge = MiddayPulseV1['deltas'][number]['badge'];

interface Delta {
  readonly type: DeltaType;
  readonly badge: DeltaBadge;
  readonly draft: ItemDraft;
  readonly insightId: string | null;
  readonly at: string;
}

/** The start of the delta window: the morning generation time, else local 07:00. */
export function middaySince(input: MiddayInput, timeZone: string): Date {
  if (input.morning?.generated_at) return new Date(input.morning.generated_at);
  return atLocalTime(input.now, '07:00', timeZone);
}

export function middayDeltas(input: MiddayInput, timeZone: string, locale: 'tr' | 'en'): Delta[] {
  const since = middaySince(input, timeZone).getTime();
  const today = localDate(input.now, timeZone);
  const isToday = (iso: string | null) => iso !== null && localDateDiffDays(today, localDate(iso, timeZone)) === 0;
  const out: Delta[] = [];
  for (const i of input.insights) {
    if (i.status !== 'open' || Date.parse(i.created_at) <= since) continue;
    const draft = fromInsight(i, timeZone);
    if (i.kind === 'reply_needed' && (i.urgency === 'urgent' || i.urgency === 'today')) {
      out.push({ type: 'new_urgent_reply', badge: 'ACİL', draft, insightId: i.id, at: i.created_at });
    } else if (i.kind === 'conflict' && isToday(i.event_at)) {
      out.push({ type: 'new_conflict', badge: 'TAKVİM', draft, insightId: i.id, at: i.created_at });
    } else if (i.kind === 'deadline' && isToday(i.due_at)) {
      out.push({ type: 'deadline_today', badge: 'SON TARİH', draft, insightId: i.id, at: i.created_at });
    }
  }
  for (const e of input.events) {
    if (Date.parse(e.updated_at) <= since || !isToday(e.start_at) || Date.parse(e.end_at) < input.now.getTime()) continue;
    out.push({
      type: e.status === 'cancelled' ? 'event_cancelled' : 'event_changed',
      badge: 'TAKVİM',
      draft: fromEvent(e, timeZone, locale),
      insightId: null,
      at: e.updated_at,
    });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 8);
}

export async function composeMidday(
  pipeline: PipelineContext,
  input: MiddayInput,
): Promise<ComposedBriefing> {
  const tz = input.briefing.time_zone || pipeline.user.timeZone;
  const l = pipeline.user.locale;
  const deltas = middayDeltas(input, tz, l);
  const remaining = input.events
    .filter((e) => e.status !== 'cancelled' && Date.parse(e.start_at) > input.now.getTime())
    .filter((e) => localDate(e.start_at, tz) === localDate(input.now, tz))
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 6);
  const payload: MiddayPulseV1 = {
    kind: 'midday',
    local_date: input.briefing.local_date,
    delta_count: deltas.length,
    headline_key: deltas.length === 0 ? 'midday.none' : 'midday.delta',
    deltas: deltas.map((d, i) => ({
      ref: `i${i + 1}`,
      type: d.type,
      insight_id: d.insightId,
      badge: d.badge,
      display_time: formatTime(d.at, tz),
      title_tr: d.draft.title,
      sub_tr: d.draft.meta,
      source_label: d.draft.source_type,
      actions: [],
    })),
    remaining_today: remaining.map((e) => ({
      time: formatTime(e.start_at, tz),
      title_tr: clip(e.title ?? '', 200),
      status_label: e.status,
      entity_type: 'calendar_event',
      entity_id: e.id,
    })),
    morning_briefing_id: input.morning?.id ?? '',
  };
  const checked = refineMiddayPulseV1(MiddayPulseV1.parse(payload));
  if (!checked.ok) throw new Error(`midday_payload_invalid:${checked.errors.join(',')}`);
  if (deltas.length === 0) {
    return {
      patch: {
        status: 'skipped',
        skipped_reason: 'no_meaningful_delta',
        generated_at: input.now.toISOString(),
        hero_line: clip(copy(l, 'briefing.midday.noChange'), 200),
        sections: [],
        counts: { delta_count: 0 },
      },
      items: [],
      notification: null,
      narrativeMode: 'none',
    };
  }
  const polished = await polishDrafts(pipeline, 'briefing_midday', deltas.map((d) => d.draft), input.now);
  const calendar = deltas.filter((d) => d.badge === 'TAKVİM').length;
  const hero = copy(l, 'today.hero.middayReady.title', { count: deltas.length });
  const sections = [
    ['midday_delta', polished.drafts] as const,
    ['schedule', remaining.map((e) => fromEvent(e, tz, l))] as const,
  ];
  return {
    patch: {
      status: 'ready',
      skipped_reason: null,
      generated_at: input.now.toISOString(),
      failed_at: null,
      error_code: null,
      headline: clip(copy(l, 'briefing.kinds.midday'), 200),
      hero_line: clip(hero, 200),
      narrative: null,
      sections: ['midday_delta', 'schedule'],
      counts: { delta_count: deltas.length, calendar, mail: deltas.length - calendar, remaining: remaining.length },
      provenance: { narrative_mode: polished.polished ? 'polished' : 'template', since: middaySince(input, tz).toISOString() },
      prompt_version_id: polished.promptVersionId,
    },
    items: itemRows(input.briefing, sections),
    notification: briefingNotification(input.briefing, 'midday.ready', {
      public: { count: deltas.length },
      sensitive: { highlights: clip(polished.drafts.slice(0, 2).map((d) => d.title).join(' · '), 160) },
    }),
    narrativeMode: polished.polished ? 'ai' : 'template',
  };
}
