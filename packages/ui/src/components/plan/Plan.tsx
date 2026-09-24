/**
 * Plan visuals (DESIGN_AUDIT §3.11): `DayStrip` / `DayChip` (dot meaning D-47: events neutral,
 * AI proposal primary, past faded; today inverted), `TimelineBlockRow` with `TimelineBlock`
 * (event / life / deadline / commitment / task; "sol renk şeridi kullanılmaz"), the now-line, and
 * `WeekDensityChart` with `StackedBar` (meeting vs focus minutes; hot days in critical text).
 */
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export type DayDot = 'none' | 'events' | 'proposal' | 'past';

export interface DayChipProps {
  /** "Cum" */
  readonly weekday: string;
  /** "5" */
  readonly day: string;
  readonly today?: boolean;
  readonly selected?: boolean;
  readonly dot?: DayDot;
  readonly onPress: () => void;
  /** "Cuma 5 Eylül, 4 etkinlik" */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** 42×60 r14 day chip; `role=tab`. */
export function DayChip({
  weekday,
  day,
  today = false,
  selected = false,
  dot = 'none',
  onPress,
  accessibilityLabel,
  testID,
}: DayChipProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const fg = today ? c.inverse.text : c.text.primary;
  const dotColor =
    dot === 'proposal'
      ? today
        ? c.brand.glow
        : c.brand.primary
      : dot === 'events'
        ? today
          ? c.brand.glow
          : c.icon.chevron
        : dot === 'past'
          ? c.control.grabber
          : undefined;
  return (
    <PressableScale
      testID={testID ?? `ui.dayChip.${today ? 'today' : selected ? 'selected' : 'default'}`}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      haptic="select"
      onPress={onPress}
      style={[
        {
          width: 42,
          minHeight: 60,
          borderRadius: theme.radius.button,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          backgroundColor: today ? c.inverse.bg : undefined,
        },
        selected && !today ? theme.elevation('selectedRing') : null,
      ]}
    >
      <Text variant="tabLabel" style={{ color: fg, opacity: 0.8 }}>
        {weekday}
      </Text>
      <Text variant="h3" numeric style={{ color: fg }}>
        {day}
      </Text>
      <View
        {...hiddenFromA11y}
        style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor }}
      />
    </PressableScale>
  );
}

export interface DayStripProps {
  readonly children: ReactNode;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** 7 day chips, space-between; `role=tablist`. Week paging is the screen's gesture. */
export function DayStrip({ children, accessibilityLabel, testID }: DayStripProps): JSX.Element {
  return (
    <View
      testID={testID ?? 'ui.dayStrip'}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 2 }}
    >
      {children}
    </View>
  );
}

export type TimelineBlockKind = 'event' | 'life' | 'deadline' | 'commitment' | 'task';

const BLOCK_ICON: Record<TimelineBlockKind, IconName | undefined> = {
  event: undefined,
  life: undefined,
  deadline: 'flag',
  commitment: 'handshake',
  task: 'add_task',
};

export interface TimelineBlockProps {
  readonly kind?: TimelineBlockKind;
  readonly title: string;
  /** "10:00–11:00 · Ofis", "Mailden tespit edildi", "Taahhüt · Mehmet" */
  readonly meta?: string;
  readonly icon?: IconName;
  /** Overlap: inset 24 with the coral marker. */
  readonly overlap?: boolean;
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** A plan block (r14 padding 10/14); each block is a button. */
export function TimelineBlock({
  kind = 'event',
  title,
  meta,
  icon,
  overlap = false,
  onPress,
  accessibilityLabel,
  testID,
}: TimelineBlockProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const glyph = icon ?? BLOCK_ICON[kind];
  const iconColor = kind === 'deadline' ? theme.tone.warning.text : c.icon.default;
  return (
    <View style={{ marginLeft: overlap ? 24 : 0 }}>
      {overlap ? (
        <View
          {...hiddenFromA11y}
          style={{
            position: 'absolute',
            left: -20,
            top: 18,
            width: 16,
            height: 2,
            backgroundColor: c.tone.critical.solid,
          }}
        />
      ) : null}
      <PressableScale
        testID={testID ?? `ui.timelineBlock.${kind}`}
        feedback="card"
        accessibilityLabel={accessibilityLabel ?? [title, meta].filter(Boolean).join(', ')}
        onPress={onPress}
        pressedStyle={{ backgroundColor: c.surfacePressed }}
        style={[
          {
            borderRadius: theme.radius.button,
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: kind === 'life' ? c.plan.life : c.plan.event,
            borderWidth: 1,
            borderColor: c.border.hairline,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {glyph === undefined ? null : <Icon name={glyph} size={16} color={iconColor} />}
          <Text variant="rowTitle" weight={600} style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </Text>
        </View>
        {meta === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong" style={{ marginTop: 2 }}>
            {meta}
          </Text>
        )}
      </PressableScale>
    </View>
  );
}

export interface TimelineBlockRowProps {
  /** Hour label ("09:00"); empty for continuation rows. */
  readonly time?: string;
  readonly children?: ReactNode;
  /** Draw the now-line at this fraction (0–1) of the row. */
  readonly nowAt?: number;
  readonly testID?: string;
}

/** Timeline row: 44 gutter (12/500 tertiary-strong, pt 8), top rule `border.row`, min 68. */
export function TimelineBlockRow({
  time,
  children,
  nowAt,
  testID,
}: TimelineBlockRowProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <View testID={testID ?? 'ui.timelineBlockRow'} style={{ flexDirection: 'row', minHeight: 68 }}>
      <View style={{ width: 44, paddingTop: 8, alignItems: 'flex-end', paddingRight: 8 }}>
        {time === undefined ? null : (
          <Text variant="meta" weight={500} tone="tertiaryStrong" numeric>
            {time}
          </Text>
        )}
      </View>
      <View
        style={{
          flex: 1,
          borderTopWidth: 1,
          borderTopColor: c.border.row,
          paddingVertical: 4,
          gap: 6,
        }}
      >
        {children}
        {nowAt === undefined ? null : (
          <View
            {...hiddenFromA11y}
            style={{
              position: 'absolute',
              left: -3,
              right: 0,
              top: `${Math.round(Math.min(1, Math.max(0, nowAt)) * 100)}%`,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: c.tone.critical.solid,
              }}
            />
            <View style={{ flex: 1, height: 1, backgroundColor: c.tone.critical.solid }} />
          </View>
        )}
      </View>
    </View>
  );
}

export interface DensityDay {
  readonly key: string;
  /** "Pzt" */
  readonly label: string;
  readonly meetingMinutes: number;
  readonly focusMinutes: number;
  readonly hot?: boolean;
  readonly today?: boolean;
  /** "Pazartesi 2 saat toplantı, 1 saat odak" */
  readonly accessibilityLabel: string;
}

export interface StackedBarProps {
  readonly meetingPx: number;
  readonly focusPx: number;
  readonly hot?: boolean;
}

/** Two stacked bars (meeting, focus), radius 5, gap 3. */
export function StackedBar({ meetingPx, focusPx, hot = false }: StackedBarProps): JSX.Element {
  const theme = useTheme();
  const week = theme.color.plan.week;
  return (
    <View
      {...hiddenFromA11y}
      style={{ alignItems: 'stretch', justifyContent: 'flex-end', gap: 3, height: 120 }}
    >
      {focusPx > 0 ? (
        <View style={{ height: focusPx, borderRadius: 5, backgroundColor: week.focus }} />
      ) : null}
      {meetingPx > 0 ? (
        <View
          style={{
            height: meetingPx,
            borderRadius: 5,
            backgroundColor: hot ? week.busy : week.meeting,
          }}
        />
      ) : null}
    </View>
  );
}

export interface WeekDensityChartProps {
  /** "1–7 Eylül · Yoğunluk" */
  readonly kicker: string;
  /** "{n} etkinlik" */
  readonly summary?: string;
  readonly days: readonly DensityDay[];
  readonly onDayPress: (key: string) => void;
  /** Legend labels ("Toplantı", "Odak", "Yoğun"). */
  readonly legend: { readonly meeting: string; readonly focus: string; readonly busy: string };
  /** Whole-chart summary for screen readers. */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Week density: bars area 120, scale `px = minutes × 120 / max(480, weekMax)`. */
export function WeekDensityChart({
  kicker,
  summary,
  days,
  onDayPress,
  legend,
  accessibilityLabel,
  testID,
}: WeekDensityChartProps): JSX.Element {
  const theme = useTheme();
  const week = theme.color.plan.week;
  const weekMax = Math.max(480, ...days.map((d) => d.meetingMinutes + d.focusMinutes));
  const scale = (minutes: number): number => (minutes * 120) / weekMax;
  const swatch = (color: string, label: string): JSX.Element => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text variant="meta" tone="tertiaryStrong">
        {label}
      </Text>
    </View>
  );
  return (
    <Card testID={testID ?? 'ui.weekDensityChart'}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel}
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}
      >
        <Text variant="kicker" tone="tertiaryStrong" style={{ flex: 1 }}>
          {kicker}
        </Text>
        {summary === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {summary}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {days.map((day) => (
          <PressableScale
            key={day.key}
            testID={`ui.weekDensityChart.${day.key}`}
            feedback="none"
            accessibilityLabel={day.accessibilityLabel}
            onPress={() => {
              onDayPress(day.key);
            }}
            style={{ flex: 1, gap: 6 }}
          >
            <StackedBar
              meetingPx={scale(day.meetingMinutes)}
              focusPx={scale(day.focusMinutes)}
              hot={day.hot}
            />
            <Text
              variant="badge"
              weight={600}
              align="center"
              style={{
                color: day.today
                  ? theme.color.brand.primary
                  : day.hot === true
                    ? theme.tone.critical.text
                    : theme.color.text.secondary,
              }}
            >
              {day.label}
            </Text>
          </PressableScale>
        ))}
      </View>
      <View {...hiddenFromA11y} style={{ flexDirection: 'row', gap: 14, marginTop: 12 }}>
        {swatch(week.meeting, legend.meeting)}
        {swatch(week.focus, legend.focus)}
        {swatch(week.busy, legend.busy)}
      </View>
    </Card>
  );
}
