import { z } from 'zod';
import { Refiner, type RefineResult } from './common.ts';

/** §4.3.9 · code-built payload (`packages/domain/briefings/evening.ts`), no LLM. */
export const EveningCloseV1 = z.strictObject({
  kind: z.literal('evening'),
  local_date: z.string(),
  completed: z.array(
    z.strictObject({
      title_tr: z.string(),
      completed_at_local: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
    }),
  ),
  carry_over: z.array(
    z.strictObject({
      title_tr: z.string(),
      meta_tr: z.string(),
      badge: z.string().nullable(),
      entity_type: z.string(),
      entity_id: z.string(),
    }),
  ),
  follow_ups: z.array(
    z.strictObject({ title_tr: z.string(), day_label_tr: z.string(), thread_id: z.string() }),
  ),
  tomorrow_first_event: z
    .strictObject({
      event_id: z.string(),
      start_local: z.string(),
      title_tr: z.string(),
      meta_tr: z.string(),
      leave_by_local: z.string().nullable(),
    })
    .nullable(),
  counts: z.strictObject({ completed: z.number(), carry_over: z.number() }),
});
export type EveningCloseV1 = z.infer<typeof EveningCloseV1>;

/** Consistency of the code-built payload: date format and the counts of both lists. */
export function refineEveningCloseV1(parsed: EveningCloseV1): RefineResult<EveningCloseV1> {
  const r = new Refiner([]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.local_date)) r.fail('local_date_format');
  if (parsed.counts.completed !== parsed.completed.length) r.fail('completed_count_mismatch');
  if (parsed.counts.carry_over !== parsed.carry_over.length) r.fail('carry_over_count_mismatch');
  return r.result(parsed);
}
