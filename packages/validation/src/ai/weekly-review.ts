import { z } from 'zod';
import { Ref, Refiner, wordCount, type BaseRefineContext, type RefineResult } from './common.ts';

const RefText = z.strictObject({ text_tr: z.string(), refs: z.array(Ref) });

/** §4.3.10 · prompt `weekly_review` (LLM narrative over code-computed stats). */
export const WeeklyReviewV1 = z.strictObject({
  narrative: z.array(RefText),
  busiest_day: RefText.nullable(),
  next_week: RefText,
  suggestion: z.strictObject({
    kind: z.enum(['focus_block', 'none']),
    slot_ref: Ref.nullable(),
    text_tr: z.string().nullable(),
  }),
});
export type WeeklyReviewV1 = z.infer<typeof WeeklyReviewV1>;

/** §4.3.10 · code-computed weekly statistics (`briefings.weekly_stats`, share card). */
export const WeeklyStatsV1 = z.strictObject({
  period_start: z.string(),
  period_end: z.string(),
  mails_analyzed: z.number(),
  important_count: z.number(),
  meetings: z.number(),
  prep_notes: z.number(),
  followups: z.number(),
  followups_answered: z.number(),
  deadlines: z.number(),
  deadlines_surfaced_in_time: z.number(),
  busiest_day: z
    .strictObject({ weekday: z.number(), meetings: z.number(), max_gap_min: z.number() })
    .nullable(),
  time_saved_min: z.number(),
  time_saved_basis: z.strictObject({
    formula_version: z.string(),
    filtered_mails: z.number(),
    prep_notes_opened: z.number(),
    drafts_sent: z.number(),
  }),
});
export type WeeklyStatsV1 = z.infer<typeof WeeklyStatsV1>;

export const WEEKLY_REVIEW_LIMITS = {
  narrative_words: 80,
  next_week_words: 45,
  text_words: 45,
} as const;

/** Word caps, known refs, and a `focus_block` suggestion that must point at an `f*` free-slot ref. */
export function refineWeeklyReviewV1(
  parsed: WeeklyReviewV1,
  ctx: BaseRefineContext,
): RefineResult<WeeklyReviewV1> {
  const r = new Refiner(ctx.aliases);
  const L = WEEKLY_REVIEW_LIMITS;
  const refs = (list: readonly string[], path: string) =>
    list.filter((ref, i) => r.ref(ref, `${path}.${i}`));
  let words = 0;
  const narrative = parsed.narrative
    .map((s, i) => ({ text_tr: s.text_tr.trim(), refs: refs(s.refs, `narrative.${i}.refs`) }))
    .filter((s, i) => {
      words += wordCount(s.text_tr);
      if (words > L.narrative_words) {
        r.drop(`narrative.${i}`, 'word_cap');
        return false;
      }
      return s.text_tr !== '';
    });
  if (narrative.length === 0) r.fail('narrative_empty');
  const busiest =
    parsed.busiest_day === null
      ? null
      : {
          text_tr: r.words(parsed.busiest_day.text_tr, L.text_words, 'busiest_day.text_tr'),
          refs: refs(parsed.busiest_day.refs, 'busiest_day.refs'),
        };
  let suggestion = parsed.suggestion;
  if (suggestion.kind === 'focus_block') {
    const slot = suggestion.slot_ref;
    if (
      slot === null ||
      !slot.startsWith('f') ||
      !r.ref(slot, 'suggestion.slot_ref') ||
      suggestion.text_tr === null
    ) {
      r.drop('suggestion', 'not_allowed');
      suggestion = { kind: 'none', slot_ref: null, text_tr: null };
    } else {
      suggestion = {
        ...suggestion,
        text_tr: r.words(suggestion.text_tr, L.text_words, 'suggestion.text_tr'),
      };
    }
  } else if (suggestion.slot_ref !== null || suggestion.text_tr !== null) {
    r.drop('suggestion', 'cleared');
    suggestion = { kind: 'none', slot_ref: null, text_tr: null };
  }
  return r.result({
    narrative,
    busiest_day: busiest,
    next_week: {
      text_tr: r.words(parsed.next_week.text_tr, L.next_week_words, 'next_week.text_tr'),
      refs: refs(parsed.next_week.refs, 'next_week.refs'),
    },
    suggestion,
  });
}

/** Consistency of the code-built stats: non-negative integers, ISO weekday, answered ≤ total. */
export function refineWeeklyStatsV1(parsed: WeeklyStatsV1): RefineResult<WeeklyStatsV1> {
  const r = new Refiner([]);
  const counts: [string, number][] = [
    ['mails_analyzed', parsed.mails_analyzed],
    ['important_count', parsed.important_count],
    ['meetings', parsed.meetings],
    ['prep_notes', parsed.prep_notes],
    ['followups', parsed.followups],
    ['followups_answered', parsed.followups_answered],
    ['deadlines', parsed.deadlines],
    ['deadlines_surfaced_in_time', parsed.deadlines_surfaced_in_time],
    ['time_saved_min', parsed.time_saved_min],
  ];
  for (const [key, value] of counts) {
    if (!Number.isInteger(value) || value < 0) r.fail(`${key}_invalid`);
  }
  if (parsed.followups_answered > parsed.followups) r.fail('followups_answered_gt_total');
  if (parsed.deadlines_surfaced_in_time > parsed.deadlines) r.fail('deadlines_surfaced_gt_total');
  if (
    parsed.busiest_day !== null &&
    !(parsed.busiest_day.weekday >= 1 && parsed.busiest_day.weekday <= 7)
  ) {
    r.fail('busiest_weekday_invalid');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed.period_start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed.period_end)
  ) {
    r.fail('period_format');
  } else if (parsed.period_end < parsed.period_start) {
    r.fail('period_order');
  }
  return r.result(parsed);
}
