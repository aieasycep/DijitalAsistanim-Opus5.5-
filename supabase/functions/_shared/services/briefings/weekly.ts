/**
 * Weekly review (IMPLEMENTATION_PLAN T-5.08; AI_PIPELINE_PLAN §4.3.10, §12.6; M§12).
 *
 * Code computes the statistics (`WeeklyStatsV1`, including the estimated time saved by the
 * deterministic formula `timeSaved@v1`, labelled "tahmini"); the `weekly_review` model only writes
 * a short narrative over them (refs `s*` for statistics, `e*` next-week events, `f*` free slots).
 * When `ai.batch.enabled` is on the narrative goes through Message Batches (`ai_batch`, JOB-28,
 * submitted Sunday 12:00 local, synchronous fallback at 17:30); otherwise it is generated
 * synchronously. Without a model the T0 template narrative is used.
 */
import {
  addDaysToLocalDate,
  computeTimeSavedV1,
  findFreeSlots,
  isoWeekStart,
  TIME_SAVED_V1,
} from '@da/domain';
import {
  refineWeeklyReviewV1,
  refineWeeklyStatsV1,
  WeeklyReviewV1,
  WeeklyStatsV1,
} from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { clip, copy, type CopyLocale, formatDay, formatTime, formatWeekday } from '../copy.ts';
import { rankInsights } from '../insights/rank.ts';
import type { WeeklyCounts } from '../intel/store.ts';
import type { BriefingPatch, BriefingRow, CalendarEventRow, InsightRow } from '../intel/types.ts';
import { briefingNotification, fromEvent, fromInsight, itemRows } from './items.ts';
import type { ComposedBriefing } from './morning.ts';

/** Monday..Sunday of the review week (the briefing's `local_date` is the Sunday). */
export function weekPeriod(localDay: string): { start: string; end: string } {
  const start = isoWeekStart(localDay);
  return { start, end: addDaysToLocalDate(start, 6) };
}

export function weeklyStats(counts: WeeklyCounts, period: { start: string; end: string }): WeeklyStatsV1 {
  const saved = computeTimeSavedV1({
    mails_analyzed: counts.mailsAnalyzed,
    important_count: Math.min(counts.importantCount, counts.mailsAnalyzed),
    prep_notes_opened: counts.prepNotesOpened,
    drafts_sent: counts.draftsSent,
  });
  const stats: WeeklyStatsV1 = {
    period_start: period.start,
    period_end: period.end,
    mails_analyzed: counts.mailsAnalyzed,
    important_count: Math.min(counts.importantCount, counts.mailsAnalyzed),
    meetings: counts.meetings,
    prep_notes: counts.prepNotes,
    followups: counts.followups,
    followups_answered: Math.min(counts.followupsAnswered, counts.followups),
    deadlines: counts.deadlines,
    deadlines_surfaced_in_time: Math.min(counts.deadlinesSurfacedInTime, counts.deadlines),
    busiest_day:
      counts.busiest === null
        ? null
        : { weekday: counts.busiest.weekday, meetings: counts.busiest.meetings, max_gap_min: counts.busiest.maxGapMin },
    time_saved_min: saved.time_saved_min,
    time_saved_basis: {
      formula_version: TIME_SAVED_V1.formula_version,
      filtered_mails: saved.basis.filtered_mails,
      prep_notes_opened: saved.basis.prep_notes_opened,
      drafts_sent: saved.basis.drafts_sent,
    },
  };
  const checked = refineWeeklyStatsV1(WeeklyStatsV1.parse(stats));
  if (!checked.ok) throw new Error(`weekly_stats_invalid:${checked.errors.join(',')}`);
  return checked.data;
}

/** "15–21 Eylül" (same month) or "29 Eylül – 5 Ekim". */
export function weekLabel(locale: CopyLocale, period: { start: string; end: string }): string {
  const tz = 'UTC';
  const a = formatDay(locale, `${period.start}T12:00:00Z`, tz);
  const b = formatDay(locale, `${period.end}T12:00:00Z`, tz);
  const [dayA, ...monthA] = a.split(' ');
  const [dayB, ...monthB] = b.split(' ');
  if (locale === 'tr' && monthA.join(' ') === monthB.join(' ')) return `${dayA}–${dayB} ${monthB.join(' ')}`;
  return `${a} – ${b}`;
}

export interface WeeklyInput {
  readonly briefing: BriefingRow;
  readonly now: Date;
  readonly counts: WeeklyCounts;
  readonly insights: readonly InsightRow[];
  /** Next week's events (outlook and free-slot search). */
  readonly nextWeek: readonly CalendarEventRow[];
}

export interface WeeklyPrompt {
  readonly docs: UntrustedDoc[];
  readonly context: string[];
  readonly stats: WeeklyStatsV1;
}

export function weeklyPrompt(pipeline: PipelineContext, input: WeeklyInput): WeeklyPrompt {
  const tz = input.briefing.time_zone || pipeline.user.timeZone;
  const l = pipeline.user.locale;
  const stats = weeklyStats(input.counts, weekPeriod(input.briefing.local_date));
  const docs: UntrustedDoc[] = [
    { ref: 's1', kind: 'summary', text: `${stats.mails_analyzed} mail analiz edildi` },
    { ref: 's2', kind: 'summary', text: `${stats.important_count} önemli konu` },
    { ref: 's3', kind: 'summary', text: `${stats.meetings} toplantı` },
    { ref: 's4', kind: 'summary', text: `${stats.followups} takip, ${stats.followups_answered} yanıtlandı` },
    { ref: 's5', kind: 'summary', text: `${stats.deadlines} son tarih` },
    { ref: 's6', kind: 'summary', text: `tahmini ${stats.time_saved_min} dakika kazanıldı` },
  ];
  if (stats.busiest_day !== null) {
    docs.push({
      ref: 's7',
      kind: 'summary',
      text: `en yoğun gün ${stats.busiest_day.weekday}. gün, ${stats.busiest_day.meetings} toplantı`,
    });
  }
  const upcoming = [...input.nextWeek]
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  upcoming.slice(0, 5).forEach((e, i) => {
    docs.push({
      ref: `e${i + 1}`,
      kind: 'event',
      text: `${formatWeekday(l, e.start_at, tz)} ${formatTime(e.start_at, tz)} ${clip(e.title ?? '', 80)}`,
    });
  });
  const nextStart = addDaysToLocalDate(weekPeriod(input.briefing.local_date).end, 1);
  const slots = findFreeSlots({
    now: new Date(Math.max(input.now.getTime(), Date.parse(`${nextStart}T00:00:00Z`))),
    timeZone: tz,
    busy: upcoming.map((e) => ({ start: e.start_at, end: e.end_at, allDay: e.all_day })),
    workingHours: pipeline.user.workingHours,
    minMinutes: 90,
    horizonDays: 7,
    bufferMinutes: 10,
  }).slice(0, 3);
  slots.forEach((s, i) => {
    docs.push({
      ref: `f${i + 1}`,
      kind: 'summary',
      text: `${formatWeekday(l, s.start, tz)} ${formatTime(s.start, tz)}–${formatTime(s.end, tz)} boş`,
    });
  });
  return { docs, context: trustedHeader(pipeline.user, input.now), stats };
}

/** The review text: grounded model narrative (refined) or the T0 template. */
export function weeklyNarrative(
  review: WeeklyReviewV1 | null,
  prompt: WeeklyPrompt,
  locale: CopyLocale,
): { text: string; mode: 'ai' | 'template' } {
  if (review !== null) {
    const refined = refineWeeklyReviewV1(review, { aliases: prompt.docs.map((d) => d.ref) });
    const sentences = refined.data.narrative.filter((s) => s.refs.length > 0).map((s) => s.text_tr);
    if (refined.ok && sentences.length > 0) {
      const extra = [
        refined.data.next_week.refs.length > 0 ? refined.data.next_week.text_tr : '',
        refined.data.suggestion.kind === 'focus_block' ? (refined.data.suggestion.text_tr ?? '') : '',
      ].filter((t) => t !== '');
      return { text: clip([...sentences, ...extra].join(' '), 3000), mode: 'ai' };
    }
  }
  const s = prompt.stats;
  return {
    text: copy(locale, 'briefing.generated.weekly.template', {
      mails: s.mails_analyzed,
      important: s.important_count,
      meetings: s.meetings,
      followups: s.followups,
    }),
    mode: 'template',
  };
}

/** Everything but the narrative (shared by the sync path and the batch collector). */
export function weeklyComposition(
  pipeline: PipelineContext,
  input: WeeklyInput,
  prompt: WeeklyPrompt,
  narrative: { text: string; mode: 'ai' | 'template' },
  promptVersionId: string | null,
): ComposedBriefing {
  const tz = input.briefing.time_zone || pipeline.user.timeZone;
  const l = pipeline.user.locale;
  const s = prompt.stats;
  const period = weekPeriod(input.briefing.local_date);
  const highlights = rankInsights(input.insights.filter((i) => i.status === 'open'))
    .slice(0, 5)
    .map((i) => fromInsight(i, tz));
  const outlook = [...input.nextWeek]
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 5)
    .map((e) => fromEvent(e, tz, l));
  const patch: BriefingPatch = {
    status: 'ready',
    skipped_reason: null,
    generated_at: input.now.toISOString(),
    failed_at: null,
    error_code: null,
    headline: clip(weekLabel(l, period), 200),
    hero_line: clip(copy(l, 'today.weekly.title', { count: s.mails_analyzed }), 200),
    narrative: narrative.text,
    sections: ['weekly_highlight', 'weekly_outlook'],
    counts: {
      mails_analyzed: s.mails_analyzed,
      important: s.important_count,
      meetings: s.meetings,
      followups: s.followups,
      deadlines: s.deadlines,
    },
    provenance: { narrative_mode: narrative.mode, period_start: period.start, period_end: period.end },
    weekly_stats: s as unknown as Record<string, unknown>,
    prompt_version_id: promptVersionId,
  };
  return {
    patch,
    items: itemRows(input.briefing, [
      ['weekly_highlight', highlights],
      ['weekly_outlook', outlook],
    ]),
    notification: briefingNotification(input.briefing, 'weekly.ready', {
      public: { important: s.important_count, meetings: s.meetings, followups: s.followups },
      sensitive: {},
    }),
    narrativeMode: narrative.mode,
  };
}

/** Synchronous path (batches off, or the 17:30 fallback). */
export async function composeWeekly(
  pipeline: PipelineContext,
  input: WeeklyInput,
): Promise<ComposedBriefing> {
  const prompt = weeklyPrompt(pipeline, input);
  const result = await callModel(pipeline, {
    feature: 'weekly_review',
    schema: WeeklyReviewV1,
    schemaName: 'WeeklyReviewV1',
    context: prompt.context,
    docs: prompt.docs,
    cacheContent: `weekly_review\n${input.briefing.id}\n${prompt.docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
    units: 1,
  });
  const narrative = weeklyNarrative(result.kind === 'ai' ? result.data : null, prompt, pipeline.user.locale);
  return weeklyComposition(
    pipeline,
    input,
    prompt,
    narrative,
    result.kind === 'ai' && narrative.mode === 'ai' ? result.promptVersionId : null,
  );
}
