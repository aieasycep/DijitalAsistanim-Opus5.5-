import { z } from 'zod';
import { Evidence, Ref, Refiner, type BaseRefineContext, type RefineResult } from './common.ts';

/*
 * §4.3.5 · prompt `life_intel`. Security events are never in this schema (T0 only). Tracking, flight
 * and PNR quotes are checked afterwards by the deterministic validators (§6.9).
 */
const Shipment = z.strictObject({
  kind: z.literal('shipment'),
  merchant_quote: z.string().nullable(),
  carrier_quote: z.string().nullable(),
  tracking_quote: z.string().nullable(),
  status: z.enum([
    'ordered',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'delivery_failed',
    'unknown',
  ]),
  eta_quote: z.string().nullable(),
  item_count_quote: z.string().nullable(),
  evidence: Evidence,
});
const Flight = z.strictObject({
  kind: z.literal('flight'),
  flight_no_quote: z.string(),
  from_quote: z.string().nullable(),
  to_quote: z.string().nullable(),
  depart_quote: z.string().nullable(),
  arrive_quote: z.string().nullable(),
  gate_quote: z.string().nullable(),
  pnr_quote: z.string().nullable(),
  checkin_status: z.enum(['open', 'not_open', 'unknown']),
  evidence: Evidence,
});
const Reservation = z.strictObject({
  kind: z.literal('reservation'),
  reservation_type: z.enum(['restaurant', 'hotel', 'event', 'transport', 'other']),
  venue_quote: z.string(),
  at_quote: z.string().nullable(),
  party_size_quote: z.string().nullable(),
  confirm_deadline_quote: z.string().nullable(),
  address_quote: z.string().nullable(),
  evidence: Evidence,
});
const Payment = z.strictObject({
  kind: z.literal('payment'),
  payee_quote: z.string(),
  amount_quote: z.string().nullable(),
  due_quote: z.string().nullable(),
  status: z.enum(['due', 'paid', 'failed', 'refund', 'unknown']),
  evidence: Evidence,
});
const Subscription = z.strictObject({
  kind: z.literal('subscription'),
  service_quote: z.string(),
  amount_quote: z.string().nullable(),
  period: z.enum(['weekly', 'monthly', 'yearly', 'unknown']),
  event: z.enum([
    'renewal_upcoming',
    'renewed',
    'trial_ending',
    'cancelled',
    'price_change',
    'unknown',
  ]),
  renews_quote: z.string().nullable(),
  evidence: Evidence,
});
export const LifeIntelEvent = z.discriminatedUnion('kind', [
  Shipment,
  Flight,
  Reservation,
  Payment,
  Subscription,
]);
export type LifeIntelEvent = z.infer<typeof LifeIntelEvent>;
export const LifeIntelV1 = z.strictObject({
  items: z.array(
    z.strictObject({
      ref: Ref,
      events: z.array(LifeIntelEvent),
      injection_suspected: z.boolean(),
    }),
  ),
});
export type LifeIntelV1 = z.infer<typeof LifeIntelV1>;

/** Keeps items with known refs and events whose evidence span is well-formed and on the same ref. */
export function refineLifeIntelV1(
  parsed: LifeIntelV1,
  ctx: BaseRefineContext,
): RefineResult<LifeIntelV1> {
  const r = new Refiner(ctx.aliases);
  const items = parsed.items
    .filter((item, index) => r.ref(item.ref, `items.${index}.ref`))
    .map((item, index) => {
      const path = `items.${index}.events`;
      const events = item.events.filter((event, i) => {
        if (!r.evidence(event.evidence, `${path}.${i}.evidence`)) return false;
        if (event.evidence.ref !== item.ref) {
          r.drop(`${path}.${i}.evidence.ref`, 'bad_ref');
          return false;
        }
        return true;
      });
      return { ...item, events };
    });
  return r.result({ items });
}
