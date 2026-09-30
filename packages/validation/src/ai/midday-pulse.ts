import { z } from 'zod';
import { Ref, Refiner, type RefineResult } from './common.ts';

/** §4.3.8 · code-built payload (`packages/domain/briefings/midday.ts`), no LLM. */
export const MiddayDeltaType = z.enum([
  'reschedule_request',
  'new_conflict',
  'new_urgent_reply',
  'deadline_today',
  'reply_received',
  'event_changed',
  'event_cancelled',
  'schedule_request',
]);
export const MiddayPulseV1 = z.strictObject({
  kind: z.literal('midday'),
  local_date: z.string(),
  delta_count: z.number(),
  headline_key: z.enum(['midday.delta', 'midday.none']),
  deltas: z.array(
    z.strictObject({
      ref: Ref,
      type: MiddayDeltaType,
      insight_id: z.string().nullable(),
      badge: z.enum(['TAKVİM', 'TAKİP', 'ACİL', 'SON TARİH']),
      display_time: z.string(),
      title_tr: z.string(),
      sub_tr: z.string().nullable(),
      source_label: z.string(),
      actions: z.array(z.string()),
    }),
  ),
  remaining_today: z.array(
    z.strictObject({
      time: z.string(),
      title_tr: z.string(),
      status_label: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
    }),
  ),
  morning_briefing_id: z.string(),
});
export type MiddayPulseV1 = z.infer<typeof MiddayPulseV1>;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Consistency of the code-built payload: date format, `delta_count` and the headline key. */
export function refineMiddayPulseV1(parsed: MiddayPulseV1): RefineResult<MiddayPulseV1> {
  const r = new Refiner([]);
  if (!LOCAL_DATE.test(parsed.local_date)) r.fail('local_date_format');
  if (!Number.isInteger(parsed.delta_count) || parsed.delta_count !== parsed.deltas.length) {
    r.fail('delta_count_mismatch');
  }
  const expectedHeadline = parsed.deltas.length === 0 ? 'midday.none' : 'midday.delta';
  if (parsed.headline_key !== expectedHeadline) r.fail('headline_mismatch');
  const refs = parsed.deltas.map((delta) => delta.ref);
  if (refs.some((ref) => !/^i\d{1,3}$/.test(ref))) r.fail('bad_ref');
  if (new Set(refs).size !== refs.length) r.fail('duplicate_ref');
  return r.result(parsed);
}
