import { useTranslations } from 'next-intl';

import { SegmentedLinks, withParam } from '@/components/module-kit';
import { METRIC_RANGES, rangeLabelKey, type MetricRange } from '@/lib/ranges';

/** "24 saat · 7 gün · 30 gün · 90 gün" as links that keep the rest of the page state. */
export function RangeLinks({
  path,
  params,
  active,
  ranges = METRIC_RANGES,
}: {
  path: string;
  params: Readonly<Record<string, string | string[] | undefined>>;
  active: MetricRange;
  ranges?: readonly MetricRange[];
}) {
  const t = useTranslations('backoffice.dashboard.range');
  return (
    <SegmentedLinks
      label={t('label')}
      active={active}
      items={ranges.map((range) => ({
        key: range,
        href: withParam(path, params, { range, page: null }),
        label: t(rangeLabelKey(range)),
      }))}
    />
  );
}
