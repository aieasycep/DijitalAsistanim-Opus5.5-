import { z } from 'zod';
import {
  Ref,
  Refiner,
  numericTokens,
  wordCount,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/**
 * §4.3.6 · prompt `briefing_morning`. Input: ranked item JSON with refs `i1..iN` and statistics
 * `s1..sK`. Section contents are chosen by code; the model only writes the prose.
 */
export const SectionKey = z.enum([
  'priorities',
  'schedule',
  'awaiting_me',
  'awaiting_them',
  'deadlines',
  'life',
]);
export type SectionKey = z.infer<typeof SectionKey>;
const RefText = z.strictObject({ text_tr: z.string(), refs: z.array(Ref) });
export const BriefingMorningV1 = z.strictObject({
  narrative: z.array(RefText),
  overview_spoken_tr: z.string(),
  overview_refs: z.array(Ref),
  section_spoken: z.array(
    z.strictObject({ section: SectionKey, text_tr: z.string(), refs: z.array(Ref) }),
  ),
  priority_reasons: z.array(z.strictObject({ ref: Ref, why_tr: z.string() })),
});
export type BriefingMorningV1 = z.infer<typeof BriefingMorningV1>;

export const BRIEFING_MORNING_LIMITS = {
  narrative_max_sentences: 5,
  narrative_words: 90,
  overview_words: 40,
  section_words: 45,
  why_chars: 80,
} as const;

export interface BriefingMorningRefineContext extends BaseRefineContext {
  /** Display text of every item/stat ref (titles, times, amounts) — the numeric guard's source. */
  readonly refTexts: Readonly<Record<string, string>>;
  /** Sections that have content, in canonical order. */
  readonly nonEmptySections: readonly SectionKey[];
  /** Refs of the top-3 priorities; one `priority_reasons` entry per ref. */
  readonly topPriorityRefs: readonly string[];
}

/** `true` when every number/time in `text` appears in the display text of one of its refs. */
export function numbersGrounded(
  text: string,
  refs: readonly string[],
  refTexts: Readonly<Record<string, string>>,
): boolean {
  const available = new Set(refs.flatMap((ref) => numericTokens(refTexts[ref] ?? '')));
  return numericTokens(text).every((token) => available.has(token));
}

/**
 * Applies the numeric guard (sentences with unsourced numbers are dropped), the word caps, the
 * canonical section order and the one-reason-per-top-priority rule. `ok=false` when no narrative
 * sentence survives: the caller then renders the T0 narrative template.
 */
export function refineBriefingMorningV1(
  parsed: BriefingMorningV1,
  ctx: BriefingMorningRefineContext,
): RefineResult<BriefingMorningV1> {
  const r = new Refiner(ctx.aliases);
  const L = BRIEFING_MORNING_LIMITS;
  const validRefs = (refs: readonly string[], path: string) =>
    refs.filter((ref, i) => r.ref(ref, `${path}.${i}`));
  let words = 0;
  const narrative = r
    .cap(parsed.narrative, L.narrative_max_sentences, 'narrative')
    .map((sentence, i) => ({
      text_tr: sentence.text_tr.trim(),
      refs: validRefs(sentence.refs, `narrative.${i}.refs`),
    }))
    .filter((sentence, i) => {
      if (!numbersGrounded(sentence.text_tr, sentence.refs, ctx.refTexts)) {
        r.drop(`narrative.${i}`, 'number_mismatch');
        return false;
      }
      words += wordCount(sentence.text_tr);
      if (words > L.narrative_words) {
        r.drop(`narrative.${i}`, 'word_cap');
        return false;
      }
      return sentence.text_tr !== '';
    });
  if (narrative.length === 0) r.fail('narrative_empty');

  const overviewRefs = validRefs(parsed.overview_refs, 'overview_refs');
  let overview = r.words(parsed.overview_spoken_tr, L.overview_words, 'overview_spoken_tr');
  if (!numbersGrounded(overview, overviewRefs, ctx.refTexts)) {
    r.drop('overview_spoken_tr', 'number_mismatch');
    overview = '';
  }

  const bySection = new Map<SectionKey, BriefingMorningV1['section_spoken'][number]>();
  parsed.section_spoken.forEach((entry, i) => {
    const path = `section_spoken.${i}`;
    if (!ctx.nonEmptySections.includes(entry.section) || bySection.has(entry.section)) {
      r.drop(path, 'not_allowed');
      return;
    }
    const refs = validRefs(entry.refs, `${path}.refs`);
    const text = r.words(entry.text_tr, L.section_words, `${path}.text_tr`);
    if (!numbersGrounded(text, refs, ctx.refTexts)) {
      r.drop(path, 'number_mismatch');
      return;
    }
    bySection.set(entry.section, { section: entry.section, text_tr: text, refs });
  });
  const sectionSpoken = ctx.nonEmptySections.flatMap((section) => {
    const entry = bySection.get(section);
    return entry === undefined ? [] : [entry];
  });

  const reasons = new Map<string, string>();
  parsed.priority_reasons.forEach((reason, i) => {
    if (!ctx.topPriorityRefs.includes(reason.ref) || reasons.has(reason.ref)) {
      r.drop(`priority_reasons.${i}`, 'not_allowed');
      return;
    }
    reasons.set(reason.ref, r.text(reason.why_tr, L.why_chars, `priority_reasons.${i}.why_tr`));
  });
  const priorityReasons = ctx.topPriorityRefs.flatMap((ref) => {
    const why = reasons.get(ref);
    return why === undefined ? [] : [{ ref, why_tr: why }];
  });

  return r.result({
    narrative,
    overview_spoken_tr: overview,
    overview_refs: overviewRefs,
    section_spoken: sectionSpoken,
    priority_reasons: priorityReasons,
  });
}
