/**
 * Evening close (IMPLEMENTATION_PLAN T-5.08; R-05; AI_PIPELINE_PLAN §4.3.9; M§11).
 *
 * Deterministic T0 lists (`EveningCloseV1`): Tamamlananlar (done today), Yarına Kalanlar (open items
 * of today's morning briefing and items due today), Takip (open follow-ups) and Yarının ilk
 * etkinliği. Hero: "Bugünden yarına {n} konu kaldı." ("Bugün her şeyi kapattın." for zero). The
 * optional polish runs only behind `ai.feature.briefing_polish`. "Yarına Hazırım" (API-BRF-02)
 * later carries the chosen `carry_over` items into tomorrow's morning briefing.
 */
import { addDaysToLocalDate, localDate, localDateDiffDays, waitingDays } from '@da/domain';
import { EveningCloseV1, refineEveningCloseV1 } from '@da/validation';
import type { PipelineContext } from '../ai/pipeline.ts';
import { clip, copy, formatTime } from '../copy.ts';
import type {
  BriefingItemRow,
  BriefingRow,
  CalendarEventRow,
  CommitmentRow,
  InsightRow,
  TaskRow,
} from '../intel/types.ts';
import { briefingNotification, fromEvent, fromInsight, type ItemDraft, itemRows } from './items.ts';
import type { ComposedBriefing } from './morning.ts';
import { polishDrafts } from './polish.ts';

export interface EveningInput {
  readonly briefing: BriefingRow;
  readonly now: Date;
  readonly insights: readonly InsightRow[];
  readonly morningItems: readonly BriefingItemRow[];
  readonly tasks: readonly TaskRow[];
  readonly commitments: readonly CommitmentRow[];
  /** Events of tomorrow (local), any status. */
  readonly tomorrowEvents: readonly CalendarEventRow[];
  readonly awaitingSince: Readonly<Record<string, string>>;
}

function doneToday(at: string | null, today: string, tz: string): boolean {
  return at !== null && localDateDiffDays(today, localDate(at, tz)) === 0;
}

export function eveningLists(input: EveningInput, tz: string, locale: 'tr' | 'en') {
  const today = localDate(input.now, tz);
  const completed: ItemDraft[] = [];
  for (const i of input.insights) {
    if (i.status === 'done' && doneToday(i.done_at, today, tz)) completed.push(fromInsight(i, tz));
  }
  for (const t of input.tasks) {
    if (t.status === 'done' && doneToday(t.completed_at, today, tz)) {
      completed.push({
        insightId: null,
        entityType: 'task',
        entityId: t.id,
        title: clip(t.title, 200),
        meta: t.completed_at === null ? null : formatTime(t.completed_at, tz),
        badge: null,
        kind: 'deadline',
        urgency: 'normal',
        at: t.completed_at,
        source_type: 'task',
        source_id: t.id,
        source_provider: t.provider,
        source_timestamp: t.created_at,
        confidence: 1,
        evidence: [],
      });
    }
  }
  for (const c of input.commitments) {
    if (c.status === 'done' && doneToday(c.completed_at, today, tz)) {
      completed.push({
        insightId: null,
        entityType: 'commitment',
        entityId: c.id,
        title: clip(c.text, 200),
        meta: c.completed_at === null ? null : formatTime(c.completed_at, tz),
        badge: 'commitment',
        kind: 'commitment',
        urgency: 'normal',
        at: c.completed_at,
        source_type: c.source_type,
        source_id: c.source_id,
        source_provider: c.source_provider,
        source_timestamp: c.source_timestamp,
        confidence: c.confidence,
        evidence: c.evidence,
      });
    }
  }
  const openById = new Map(input.insights.filter((i) => i.status === 'open').map((i) => [i.id, i]));
  const carry: ItemDraft[] = [];
  const seen = new Set<string>();
  for (const item of input.morningItems) {
    if (item.insight_id === null) continue;
    const insight = openById.get(item.insight_id);
    if (insight === undefined || seen.has(insight.id)) continue;
    seen.add(insight.id);
    carry.push(fromInsight(insight, tz));
  }
  for (const i of openById.values()) {
    if (seen.has(i.id) || i.kind === 'follow_up') continue;
    if (i.due_at !== null && localDate(i.due_at, tz) <= today) {
      seen.add(i.id);
      carry.push(fromInsight(i, tz));
    }
  }
  const followUps = [...openById.values()]
    .filter((i) => i.kind === 'follow_up' && i.entity_type === 'email_thread')
    .slice(0, 5)
    .map((i) => {
      const since = input.awaitingSince[i.entity_id] ?? i.source_timestamp;
      const days = waitingDays(since, input.now, tz);
      return { insight: i, days, draft: { ...fromInsight(i, tz), meta: copy(locale, 'briefing.generated.evening.waitingDays', { days }) } };
    });
  const tomorrow = addDaysToLocalDate(today, 1);
  const first = input.tomorrowEvents
    .filter((e) => e.status !== 'cancelled' && !e.all_day && localDate(e.start_at, tz) === tomorrow)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0];
  return { completed: completed.slice(0, 10), carry: carry.slice(0, 10), followUps, first };
}

export async function composeEvening(
  pipeline: PipelineContext,
  input: EveningInput,
): Promise<ComposedBriefing> {
  const tz = input.briefing.time_zone || pipeline.user.timeZone;
  const l = pipeline.user.locale;
  const lists = eveningLists(input, tz, l);
  const payload: EveningCloseV1 = {
    kind: 'evening',
    local_date: input.briefing.local_date,
    completed: lists.completed.map((d) => ({
      title_tr: d.title,
      completed_at_local: d.at === null ? '' : formatTime(d.at, tz),
      entity_type: d.entityType,
      entity_id: d.entityId,
    })),
    carry_over: lists.carry.map((d) => ({
      title_tr: d.title,
      meta_tr: d.meta ?? '',
      badge: d.badge,
      entity_type: d.entityType,
      entity_id: d.entityId,
    })),
    follow_ups: lists.followUps.map((f) => ({
      title_tr: f.draft.title,
      day_label_tr: f.draft.meta ?? '',
      thread_id: f.insight.entity_id,
    })),
    tomorrow_first_event:
      lists.first === undefined
        ? null
        : {
            event_id: lists.first.id,
            start_local: formatTime(lists.first.start_at, tz),
            title_tr: clip(lists.first.title ?? '', 200),
            meta_tr: fromEvent(lists.first, tz, l).meta ?? '',
            leave_by_local: null,
          },
    counts: { completed: lists.completed.length, carry_over: lists.carry.length },
  };
  const checked = refineEveningCloseV1(EveningCloseV1.parse(payload));
  if (!checked.ok) throw new Error(`evening_payload_invalid:${checked.errors.join(',')}`);
  const polished = await polishDrafts(pipeline, 'briefing_evening', lists.carry, input.now);
  const n = lists.carry.length;
  const hero = n === 0 ? copy(l, 'today.hero.eveningReady.zero') : copy(l, 'today.hero.eveningReady.title', { count: n });
  const sections = [
    ['completed', lists.completed] as const,
    ['carry_over', polished.drafts] as const,
    ['follow_up', lists.followUps.map((f) => f.draft)] as const,
    ['tomorrow_first', lists.first === undefined ? [] : [fromEvent(lists.first, tz, l)]] as const,
  ];
  return {
    patch: {
      status: 'ready',
      skipped_reason: null,
      generated_at: input.now.toISOString(),
      failed_at: null,
      error_code: null,
      headline: clip(copy(l, 'briefing.kinds.evening'), 200),
      hero_line: clip(hero, 200),
      narrative: null,
      sections: ['completed', 'carry_over', 'follow_up', 'tomorrow_first'],
      counts: {
        completed: lists.completed.length,
        carry_over: n,
        follow_ups: lists.followUps.length,
        tomorrow_first_at: lists.first?.start_at ?? null,
      },
      provenance: { narrative_mode: polished.polished ? 'polished' : 'template' },
      prompt_version_id: polished.promptVersionId,
    },
    items: itemRows(input.briefing, sections),
    notification: briefingNotification(input.briefing, n === 0 ? 'evening.clear' : 'evening.ready', {
      public: n === 0 ? {} : { count: n },
      sensitive: n === 0 ? {} : { highlights: clip(polished.drafts.slice(0, 2).map((d) => d.title).join(' · '), 160) },
    }),
    narrativeMode: polished.polished ? 'ai' : 'template',
  };
}
