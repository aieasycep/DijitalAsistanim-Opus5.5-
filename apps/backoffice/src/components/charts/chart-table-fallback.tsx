'use client';

import { useTranslations } from 'next-intl';

import type { ChartPoint } from './chart-data';

/** [Tablo olarak göster]: the same series as an accessible table (BACKOFFICE_PLAN §5.7). */
export function ChartTableFallback({
  caption,
  points,
  formatValue,
  formatDate,
}: {
  caption: string;
  points: readonly ChartPoint[];
  formatValue: (value: number) => string;
  formatDate: (iso: string) => string;
}) {
  const t = useTranslations('backoffice.charts');
  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-bo-table tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-bo-meta font-semibold text-ink-2">
              {t('date')}
            </th>
            <th scope="col" className="px-3 py-2 text-right text-bo-meta font-semibold text-ink-2">
              {t('value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.t} className="border-t border-border-row">
              <td className="px-3 py-1.5 text-ink">{formatDate(point.t)}</td>
              <td className="px-3 py-1.5 text-right text-ink">{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
