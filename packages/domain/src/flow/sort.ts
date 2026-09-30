/**
 * Flow feed ordering (M-FLOW-01 "sorted urgency → time"; SREQ-08; TEST_PLAN UT-FLOW-01), the
 * client-side mirror of the RPC-05 `flow_feed` order `(sort_bucket asc, sort_at)`:
 *
 * 1. Urgency bucket: `urgent` (0) → `today` (1) → `normal` (2) → `low` (3).
 * 2. Time inside the bucket:
 *    - `urgent` and `today`: earliest due/start first. The time is the earlier of `due_at` and
 *      `event_at`; an item with neither uses `display_at`.
 *    - `normal` and `low`: newest first by `display_at`.
 * 3. Items that tie on both keys keep their input order (the sort is stable), so a cached page
 *    never reshuffles between renders.
 */
import type { Urgency } from '../enums.ts';

export const FLOW_URGENCY_BUCKET: Readonly<Record<Urgency, number>> = {
  urgent: 0,
  today: 1,
  normal: 2,
  low: 3,
};

export interface FlowSortable {
  urgency: Urgency;
  /** ISO timestamp of the item's deadline, if any (`insights.due_at`). */
  due_at?: string | null;
  /** ISO timestamp of the related event start, if any (`insights.event_at`). */
  event_at?: string | null;
  /** ISO timestamp the card is shown with (source time). */
  display_at: string;
}

export interface FlowSortKey {
  bucket: number;
  /** Epoch milliseconds of the time key. */
  at: number;
  /** True when the bucket orders ascending (earliest first). */
  ascending: boolean;
}

function epoch(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function flowSortBucket(urgency: Urgency): number {
  return FLOW_URGENCY_BUCKET[urgency];
}

export function flowSortKey(item: FlowSortable): FlowSortKey {
  const bucket = flowSortBucket(item.urgency);
  const ascending = bucket <= FLOW_URGENCY_BUCKET.today;
  const display = epoch(item.display_at) ?? 0;
  if (!ascending) return { bucket, at: display, ascending };
  const candidates = [epoch(item.due_at), epoch(item.event_at)].filter(
    (value): value is number => value !== null,
  );
  return { bucket, at: candidates.length > 0 ? Math.min(...candidates) : display, ascending };
}

/** Comparator for the Flow order; ties return 0 (combine with a stable sort). */
export function compareFlowItems(a: FlowSortable, b: FlowSortable): number {
  const ka = flowSortKey(a);
  const kb = flowSortKey(b);
  if (ka.bucket !== kb.bucket) return ka.bucket - kb.bucket;
  if (ka.at === kb.at) return 0;
  return ka.ascending ? ka.at - kb.at : kb.at - ka.at;
}

/** Returns a new array in Flow order; equal items keep their relative input order. */
export function sortFlowItems<T extends FlowSortable>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, key: flowSortKey(item) }))
    .sort((x, y) => {
      if (x.key.bucket !== y.key.bucket) return x.key.bucket - y.key.bucket;
      if (x.key.at !== y.key.at) {
        return x.key.ascending ? x.key.at - y.key.at : y.key.at - x.key.at;
      }
      return x.index - y.index;
    })
    .map((entry) => entry.item);
}
