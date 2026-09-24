import { formatNumber, formatPercent, formatUsd, type UiLocale } from '@/lib/format';

/** One point of an admin-api series (`GET /dashboard/charts` → `{points: [{t, value}]}`). */
export interface ChartPoint {
  readonly t: string;
  readonly value: number;
}

export type ValueFormat = 'number' | 'usd' | 'percent';

export function valueFormatter(locale: UiLocale, format: ValueFormat): (value: number) => string {
  if (format === 'usd') return (value) => formatUsd(locale, value);
  if (format === 'percent') return (value) => formatPercent(locale, value);
  return (value) => formatNumber(locale, value);
}

/** Total and peak of a series for the `aria-describedby` summary (§5.7 accessibility). */
export function seriesSummary(points: readonly ChartPoint[]): {
  total: number;
  peak: ChartPoint | null;
} {
  let total = 0;
  let peak: ChartPoint | null = null;
  for (const point of points) {
    total += point.value;
    if (peak === null || point.value > peak.value) peak = point;
  }
  return { total, peak };
}
