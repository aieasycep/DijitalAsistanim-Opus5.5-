/*
 * Series transforms for the module charts (BACKOFFICE_PLAN §5.7, §13.1 "Charts: data transforms").
 * Pure, so they are unit-tested: long entries → one row per time bucket with the top N keys as
 * columns and the rest summed under `other` ("Diğer").
 */

export const OTHER_KEY = 'other';

export interface LongEntry {
  readonly t: string;
  readonly key: string;
  readonly value: number;
}

export interface Pivoted {
  /** The kept keys by total, largest first; `other` last when anything was folded into it. */
  readonly keys: readonly string[];
  readonly rows: readonly ({ t: string } & Record<string, number | string>)[];
}

export function pivotTop(entries: readonly LongEntry[], top = 6): Pivoted {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.key, (totals.get(entry.key) ?? 0) + entry.value);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = new Set(ranked.slice(0, top).map(([key]) => key));
  const folded = ranked.length > top;
  const byT = new Map<string, Record<string, number>>();
  for (const entry of entries) {
    const row = byT.get(entry.t) ?? {};
    const column = kept.has(entry.key) ? entry.key : OTHER_KEY;
    row[column] = (row[column] ?? 0) + entry.value;
    byT.set(entry.t, row);
  }
  const keys = [...kept].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  if (folded) keys.push(OTHER_KEY);
  const rows = [...byT.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, values]) => {
      const row: { t: string } & Record<string, number | string> = { t };
      for (const key of keys) row[key] = values[key] ?? 0;
      return row;
    });
  return { keys, rows };
}

/** Dashboard points with an optional `breakdown` → long entries (the total when none is given). */
export function breakdownEntries(
  points: readonly { t: string; value: number; breakdown?: Readonly<Record<string, number>> }[],
  totalKey: string,
): LongEntry[] {
  return points.flatMap((point) =>
    point.breakdown === undefined || Object.keys(point.breakdown).length === 0
      ? [{ t: point.t, key: totalKey, value: point.value }]
      : Object.entries(point.breakdown).map(([key, value]) => ({ t: point.t, key, value })),
  );
}

/** Request-weighted mean of a rate over rows (`null` when there are no requests). */
export function weightedRate(rows: readonly { requests: number; rate: number }[]): number | null {
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);
  if (requests === 0) return null;
  return rows.reduce((sum, row) => sum + row.rate * row.requests, 0) / requests;
}

/** Opacity ramp for AI series (indigo, decreasing), with "Diğer" neutral (§5.7). */
export function aiRamp(index: number): number {
  return [1, 0.8, 0.62, 0.48, 0.36, 0.26][index] ?? 0.2;
}
