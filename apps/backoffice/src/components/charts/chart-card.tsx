'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardTitle, Skeleton } from '@/components/ui/card';
import { formatDay } from '@/lib/format';
import { ChartTableFallback } from './chart-table-fallback';
import { seriesSummary, valueFormatter, type ChartPoint, type ValueFormat } from './chart-data';
import { TimeSeriesChart } from './time-series-chart';
import { useMounted, type SeriesKind } from './use-chart-colors';

/**
 * Chart card (BACKOFFICE_PLAN §5.7): title, an `aria-describedby` summary with the total and the
 * peak, a [Tablo olarak göster] toggle and the empty copy "Bu aralıkta veri yok.". Series are never
 * told apart by colour alone: every card carries one titled series.
 */
export function ChartCard({
  title,
  points,
  kind,
  format = 'number',
}: {
  title: string;
  points: readonly ChartPoint[];
  kind: SeriesKind;
  format?: ValueFormat;
}) {
  const t = useTranslations('backoffice.charts');
  const locale = useLocale();
  const mounted = useMounted();
  const summaryId = useId();
  const [asTable, setAsTable] = useState(false);
  const formatValue = valueFormatter(locale, format);
  const formatDate = (iso: string) => formatDay(locale, iso);
  const { total, peak } = seriesSummary(points);
  const empty = points.length === 0;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {empty ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={asTable}
            onClick={() => {
              setAsTable((v) => !v);
            }}
          >
            {asTable ? t('showChart') : t('showTable')}
          </Button>
        )}
      </div>
      {empty ? (
        <p role="status" className="py-10 text-center text-bo-body text-ink-2">
          {t('empty')}
        </p>
      ) : (
        <>
          <p id={summaryId} className="sr-only">
            {t('summary', {
              total: formatValue(total),
              peak: peak === null ? '—' : formatValue(peak.value),
              peakDate: peak === null ? '—' : formatDate(peak.t),
            })}
          </p>
          {asTable ? (
            <ChartTableFallback
              caption={title}
              points={points}
              formatValue={formatValue}
              formatDate={formatDate}
            />
          ) : (
            <figure aria-label={title} aria-describedby={summaryId} className="m-0">
              {mounted ? (
                <TimeSeriesChart
                  points={points}
                  kind={kind}
                  formatValue={formatValue}
                  formatDate={formatDate}
                />
              ) : (
                <Skeleton className="h-[220px] w-full" />
              )}
            </figure>
          )}
        </>
      )}
    </Card>
  );
}
