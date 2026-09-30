'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardTitle, Skeleton } from '@/components/ui/card';
import { formatDay } from '@/lib/format';
import { valueFormatter, type ValueFormat } from './chart-data';
import { useChartColors, useMounted, type SeriesKind } from './use-chart-colors';

/*
 * Multi-series chart card (BACKOFFICE_PLAN §5.7): stacked bars (cost by feature, top groups plus
 * "Diğer") or lines (p50/p95 latency, error rate). Every series has a legend entry and a column in the
 * [Tablo olarak göster] fallback, so series are never told apart by colour alone; the AI ramp is the
 * indigo token at decreasing opacity, "Diğer" and previous-period series are neutral and dashed.
 */

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly kind: SeriesKind;
  /** 0–1 fill opacity for ramps (AI series); lines ignore it. */
  readonly opacity?: number;
  readonly dashed?: boolean;
}

export type ChartRow = { readonly t: string } & Readonly<Record<string, number | string>>;

export function MultiSeriesChartCard({
  title,
  series,
  rows,
  mode,
  format = 'number',
  categorical = false,
  testId,
}: {
  title: string;
  series: readonly ChartSeries[];
  rows: readonly ChartRow[];
  mode: 'stacked' | 'bars' | 'lines';
  format?: ValueFormat;
  /** `t` is a category label (feature, model) instead of a date. */
  categorical?: boolean;
  testId?: string;
}) {
  const t = useTranslations('backoffice.charts');
  const locale = useLocale();
  const mounted = useMounted();
  const colors = useChartColors();
  const summaryId = useId();
  const [asTable, setAsTable] = useState(false);
  const formatValue = valueFormatter(locale, format);
  const formatX = (value: string) => (categorical ? value : formatDay(locale, value));
  const empty = rows.length === 0;
  const total = rows.reduce(
    (sum, row) => sum + series.reduce((s, item) => s + Number(row[item.key] ?? 0), 0),
    0,
  );

  const axis = { fill: colors.axis, fontSize: 12 };
  const tooltip = (
    <Tooltip
      cursor={{ fill: colors.cursor, stroke: colors.cursor }}
      contentStyle={{
        background: colors.tooltipBg,
        color: colors.tooltipText,
        border: 'none',
        borderRadius: 10,
        fontVariantNumeric: 'tabular-nums',
      }}
      labelFormatter={(label) => (typeof label === 'string' ? formatX(label) : '')}
      formatter={(value) => formatValue(Number(value))}
    />
  );
  const common = (
    <>
      <CartesianGrid stroke={colors.grid} vertical={false} />
      <XAxis
        dataKey="t"
        tickFormatter={formatX}
        tick={axis}
        axisLine={false}
        tickLine={false}
        minTickGap={16}
      />
      <YAxis tickFormatter={formatValue} tick={axis} axisLine={false} tickLine={false} width={64} />
      {tooltip}
      <Legend wrapperStyle={{ fontSize: 12, color: colors.axis }} />
    </>
  );

  return (
    <Card className="flex flex-col gap-3" data-testid={testId}>
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
      ) : asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-bo-table tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-sunken">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-bo-meta font-semibold text-ink-2"
                >
                  {categorical ? t('category') : t('date')}
                </th>
                {series.map((item) => (
                  <th
                    key={item.key}
                    scope="col"
                    className="px-3 py-2 text-right text-bo-meta font-semibold text-ink-2"
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.t} className="border-t border-border-row">
                  <td className="px-3 py-1.5 text-ink">{formatX(row.t)}</td>
                  {series.map((item) => (
                    <td key={item.key} className="px-3 py-1.5 text-right text-ink">
                      {formatValue(Number(row[item.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p id={summaryId} className="sr-only">
            {t('multiSummary', { series: series.length, total: formatValue(total) })}
          </p>
          <figure aria-label={title} aria-describedby={summaryId} className="m-0">
            {mounted ? (
              <ResponsiveContainer width="100%" height={240}>
                {mode === 'lines' ? (
                  <LineChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    {common}
                    {series.map((item) => (
                      <Line
                        key={item.key}
                        type="monotone"
                        dataKey={item.key}
                        name={item.label}
                        stroke={colors[item.kind]}
                        strokeWidth={2}
                        strokeDasharray={item.dashed === true ? '6 4' : undefined}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    {common}
                    {series.map((item) => (
                      <Bar
                        key={item.key}
                        dataKey={item.key}
                        name={item.label}
                        stackId={mode === 'stacked' ? 'stack' : undefined}
                        fill={colors[item.kind]}
                        fillOpacity={item.opacity ?? 1}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[240px] w-full" />
            )}
          </figure>
        </>
      )}
    </Card>
  );
}
