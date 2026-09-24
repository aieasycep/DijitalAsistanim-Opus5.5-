/** Metric ranges (BACKOFFICE_PLAN §7.1; `@da/validation` `MetricsRange`). */
export const METRIC_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export function parseRange<R extends string>(
  value: string | string[] | undefined,
  allowed: readonly R[],
  fallback: R,
): R {
  const raw = Array.isArray(value) ? value[0] : value;
  return allowed.includes(raw as R) ? (raw as R) : fallback;
}

/** The `backoffice.dashboard.range` label key of a range. */
export function rangeLabelKey(range: MetricRange): 'r24h' | 'r7d' | 'r30d' | 'r90d' {
  return `r${range}`;
}
