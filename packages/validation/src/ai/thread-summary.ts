import { z } from 'zod';
import {
  Confidence,
  Evidence,
  Refiner,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

const TextWithEvidence = z.strictObject({ text_tr: z.string(), evidence: Evidence });

/** §4.3.2 · prompt `thread_summary`; evidence refs point to the thread's `m*` aliases. */
export const ThreadSummaryV1 = z.strictObject({
  summary_tr: z.string(),
  key_points: z.array(TextWithEvidence),
  decisions: z.array(TextWithEvidence),
  open_questions: z.array(
    z.strictObject({
      text_tr: z.string(),
      owner: z.enum(['user', 'counterparty', 'unclear']),
      evidence: Evidence,
    }),
  ),
  latest_ask: TextWithEvidence.nullable(),
  injection_suspected: z.boolean(),
  confidence: Confidence,
});
export type ThreadSummaryV1 = z.infer<typeof ThreadSummaryV1>;

export const THREAD_SUMMARY_LIMITS = {
  summary_words: 60,
  key_points: 5,
  decisions: 3,
  open_questions: 3,
  item_chars: 200,
} as const;

export function refineThreadSummaryV1(
  parsed: ThreadSummaryV1,
  ctx: BaseRefineContext,
): RefineResult<ThreadSummaryV1> {
  const r = new Refiner(ctx.aliases);
  const summary = r.words(parsed.summary_tr, THREAD_SUMMARY_LIMITS.summary_words, 'summary_tr');
  if (summary === '') r.fail('empty_summary');
  const verified = <T extends { text_tr: string; evidence: Evidence }>(
    items: T[],
    max: number,
    path: string,
  ): T[] =>
    r
      .cap(items, max, path)
      .filter((item, i) => r.evidence(item.evidence, `${path}.${i}.evidence`))
      .map((item, i) => ({
        ...item,
        text_tr: r.text(item.text_tr, THREAD_SUMMARY_LIMITS.item_chars, `${path}.${i}.text_tr`),
      }));
  const latest =
    parsed.latest_ask !== null && r.evidence(parsed.latest_ask.evidence, 'latest_ask.evidence')
      ? {
          ...parsed.latest_ask,
          text_tr: r.text(
            parsed.latest_ask.text_tr,
            THREAD_SUMMARY_LIMITS.item_chars,
            'latest_ask.text_tr',
          ),
        }
      : null;
  return r.result({
    ...parsed,
    summary_tr: summary,
    key_points: verified(parsed.key_points, THREAD_SUMMARY_LIMITS.key_points, 'key_points'),
    decisions: verified(parsed.decisions, THREAD_SUMMARY_LIMITS.decisions, 'decisions'),
    open_questions: verified(
      parsed.open_questions,
      THREAD_SUMMARY_LIMITS.open_questions,
      'open_questions',
    ),
    latest_ask: latest,
  });
}
