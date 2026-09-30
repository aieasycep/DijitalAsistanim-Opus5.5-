import { z } from 'zod';
import {
  Confidence,
  Evidence,
  Ref,
  Refiner,
  wordCount,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/**
 * §4.3.11 · prompt `meeting_prep`. `user_owes` / `they_owe` / `recent_emails` are computed by code from
 * `commitments`, follow-up state and `email_messages`, never by the model.
 */
export const MeetingPrepV1 = z.strictObject({
  purpose: z.strictObject({
    text_tr: z.string(),
    basis: z.enum(['invite_description', 'email', 'note', 'inferred']),
    evidence: Evidence.nullable(),
  }),
  talking_points: z.array(
    z.strictObject({
      title_tr: z.string(),
      body_tr: z.string(),
      refs: z.array(Ref),
      evidence: Evidence,
    }),
  ),
  last_interaction: z
    .strictObject({ text_tr: z.string(), refs: z.array(Ref), evidence: Evidence })
    .nullable(),
  open_loops: z.array(
    z.strictObject({ text_tr: z.string(), refs: z.array(Ref), evidence: Evidence }),
  ),
  summary_2min: z.array(z.strictObject({ text_tr: z.string(), refs: z.array(Ref) })),
  injection_suspected: z.boolean(),
  confidence: Confidence,
});
export type MeetingPrepV1 = z.infer<typeof MeetingPrepV1>;

export const MEETING_PREP_LIMITS = {
  talking_points: 3,
  title_chars: 24,
  body_chars: 140,
  open_loops: 4,
  summary_paragraphs: 3,
  summary_words: 260,
  text_chars: 300,
} as const;

/**
 * Talking points: at most 3, at least 1 kept (`ok=false` otherwise), each with verified evidence;
 * `basis='inferred'` caps the confidence at `medium` and drops the purpose evidence.
 */
export function refineMeetingPrepV1(
  parsed: MeetingPrepV1,
  ctx: BaseRefineContext,
): RefineResult<MeetingPrepV1> {
  const r = new Refiner(ctx.aliases);
  const L = MEETING_PREP_LIMITS;
  const refs = (list: readonly string[], path: string) =>
    list.filter((ref, i) => r.ref(ref, `${path}.${i}`));
  const talking = r
    .cap(parsed.talking_points, L.talking_points, 'talking_points')
    .filter((point, i) => r.evidence(point.evidence, `talking_points.${i}.evidence`))
    .map((point, i) => ({
      title_tr: r.text(point.title_tr, L.title_chars, `talking_points.${i}.title_tr`),
      body_tr: r.text(point.body_tr, L.body_chars, `talking_points.${i}.body_tr`),
      refs: refs(point.refs, `talking_points.${i}.refs`),
      evidence: point.evidence,
    }));
  if (talking.length === 0) r.fail('no_talking_points');

  const inferred = parsed.purpose.basis === 'inferred';
  const purpose = {
    text_tr: r.text(parsed.purpose.text_tr, L.text_chars, 'purpose.text_tr'),
    basis: parsed.purpose.basis,
    evidence: inferred ? null : r.optionalEvidence(parsed.purpose.evidence, 'purpose.evidence'),
  };
  let confidence = parsed.confidence;
  if (inferred && confidence === 'high') {
    r.drop('confidence', 'cleared');
    confidence = 'medium';
  }

  const last =
    parsed.last_interaction !== null &&
    r.evidence(parsed.last_interaction.evidence, 'last_interaction.evidence')
      ? {
          text_tr: r.text(
            parsed.last_interaction.text_tr,
            L.text_chars,
            'last_interaction.text_tr',
          ),
          refs: refs(parsed.last_interaction.refs, 'last_interaction.refs'),
          evidence: parsed.last_interaction.evidence,
        }
      : null;
  const loops = r
    .cap(parsed.open_loops, L.open_loops, 'open_loops')
    .filter((loop, i) => r.evidence(loop.evidence, `open_loops.${i}.evidence`))
    .map((loop, i) => ({
      ...loop,
      text_tr: r.text(loop.text_tr, L.text_chars, `open_loops.${i}.text_tr`),
      refs: refs(loop.refs, `open_loops.${i}.refs`),
    }));

  let words = 0;
  const summary = r
    .cap(parsed.summary_2min, L.summary_paragraphs, 'summary_2min')
    .map((p, i) => ({ text_tr: p.text_tr.trim(), refs: refs(p.refs, `summary_2min.${i}.refs`) }))
    .filter((p, i) => {
      words += wordCount(p.text_tr);
      if (words > L.summary_words) {
        r.drop(`summary_2min.${i}`, 'word_cap');
        return false;
      }
      return p.text_tr !== '';
    });

  return r.result({
    purpose,
    talking_points: talking,
    last_interaction: last,
    open_loops: loops,
    summary_2min: summary,
    injection_suspected: parsed.injection_suspected,
    confidence,
  });
}
