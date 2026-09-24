import { useLocale, useTranslations } from 'next-intl';

import { createFormatters } from '@/lib/formatters';

/*
 * Named aggregate groups from `GET /metrics/ops` and `GET /metrics/product` (BACKOFFICE_PLAN §7.4):
 * counts and rates only. Known metric names use the §7.4 labels; ratios (names ending in `_rate`,
 * `_ratio`, `_share` or `conversion`) render as percentages.
 */

const RATIO = /(_rate|_ratio|_share|conversion)$/;

export function isRatioMetric(name: string): boolean {
  return RATIO.test(name);
}

export function MetricGroups({
  groups,
}: {
  groups: Readonly<Record<string, Readonly<Record<string, number>>>>;
}) {
  const t = useTranslations('backoffice.metrics');
  const f = createFormatters(useLocale());
  const names = Object.keys(groups);
  if (names.length === 0) return <p className="text-bo-body text-ink-2">{t('empty')}</p>;
  const label = (kind: 'groups' | 'names', key: string) => {
    const path = `${kind}.${key}` as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : key;
  };
  return (
    <div className="flex flex-col gap-4">
      {names.map((group) => (
        <table key={group} className="w-full text-bo-table tabular-nums">
          <caption className="pb-1 text-left text-bo-kicker text-ink-3 uppercase">
            {label('groups', group)}
          </caption>
          <tbody>
            {Object.entries(groups[group] ?? {}).map(([name, value]) => (
              <tr key={name} className="border-t border-border-row">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                  {label('names', name)}
                </th>
                <td className="py-1.5 text-right text-ink">
                  {isRatioMetric(name) ? f.percent(value) : f.number(value, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
