'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartPoint } from './chart-data';
import { useChartColors, type SeriesKind } from './use-chart-colors';

/**
 * A single time series (Recharts 3, client-only). Colours come from the theme tokens; the series
 * kind carries the semantic (AI = indigo, failures = coral, …, §5.7).
 */
export function TimeSeriesChart({
  points,
  kind,
  formatValue,
  formatDate,
  height = 220,
}: {
  points: readonly ChartPoint[];
  kind: SeriesKind;
  formatValue: (value: number) => string;
  formatDate: (iso: string) => string;
  height?: number;
}) {
  const colors = useChartColors();
  const stroke = colors[kind];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={formatDate}
          tick={{ fill: colors.axis, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={formatValue}
          tick={{ fill: colors.axis, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          cursor={{ stroke: colors.cursor }}
          contentStyle={{
            background: colors.tooltipBg,
            color: colors.tooltipText,
            border: 'none',
            borderRadius: 10,
            fontVariantNumeric: 'tabular-nums',
          }}
          labelFormatter={(label) => (typeof label === 'string' ? formatDate(label) : '')}
          formatter={(value) => formatValue(Number(value))}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          fill={stroke}
          fillOpacity={0.12}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
