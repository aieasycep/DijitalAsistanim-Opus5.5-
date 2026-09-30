import { z } from 'zod';
import { Certainty, Evidence, Refiner, TEXT_CAPS, type RefineResult } from './common.ts';

/** §4.3.12 · prompt `post_meeting`; the only source is the user's own note (`evidence.ref = "n1"`). */
export const PostMeetingCommitmentV1 = z.strictObject({
  items: z.array(
    z.strictObject({
      owner: z.enum(['user', 'counterparty', 'team']),
      what_tr: z.string(),
      counterparty_quote: z.string().nullable(),
      due_quote: z.string().nullable(),
      evidence: Evidence,
      certainty: Certainty,
    }),
  ),
  note_summary_tr: z.string().nullable(),
  injection_suspected: z.boolean(),
});
export type PostMeetingCommitmentV1 = z.infer<typeof PostMeetingCommitmentV1>;

export const POST_MEETING_LIMITS = { items: 6, note_ref: 'n1' } as const;

/** At most 6 items, evidence on `n1` only, negated claims dropped. */
export function refinePostMeetingCommitmentV1(
  parsed: PostMeetingCommitmentV1,
): RefineResult<PostMeetingCommitmentV1> {
  const r = new Refiner([POST_MEETING_LIMITS.note_ref]);
  const items = r
    .cap(parsed.items, POST_MEETING_LIMITS.items, 'items')
    .filter((item, i) => {
      if (item.certainty === 'negated') {
        r.drop(`items.${i}`, 'negated');
        return false;
      }
      return r.evidence(item.evidence, `items.${i}.evidence`);
    })
    .map((item, i) => ({
      ...item,
      what_tr: r.text(item.what_tr, TEXT_CAPS.what_tr, `items.${i}.what_tr`),
    }));
  return r.result({
    items,
    note_summary_tr: r.nullableText(
      parsed.note_summary_tr,
      TEXT_CAPS.summary_tr,
      'note_summary_tr',
    ),
    injection_suspected: parsed.injection_suspected,
  });
}
