/**
 * Lists, section headers and rows (DESIGN_AUDIT §3.5). Rule (verbatim P:01): "liste satırı min 50".
 * Dividers sit between rows, never above the first. Switch rows expose `role=switch` on the whole
 * row; navigation rows are buttons with a composed label ("Brifing, 08:00 · 13:00 · 19:00").
 */
import { Children, Fragment, isValidElement, type JSX, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Divider } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { StatusTone } from '../badges/Badge.tsx';
import { CheckIndicator, RadioIndicator, SwitchTrack } from '../inputs/Controls.tsx';

export interface SectionHeaderProps {
  /** Kicker text ("Önceliklerin"; upper-cased). */
  readonly title: string;
  /** Trailing count ("5 konu"), baseline-aligned. */
  readonly count?: string;
  /** Spoken count ("5 konu"). */
  readonly countAccessibilityLabel?: string;
  /** `dot`: 6 px tone dot + label in tone text; `tone`: label in tone text. */
  readonly variant?: 'plain' | 'dot' | 'tone';
  readonly tone?: Extract<StatusTone, 'critical' | 'warning' | 'success' | 'neutral'>;
  /** Trailing action ("Tümünü gör"). */
  readonly action?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Section kicker header (alias `SectionKicker`): padding 0/4/8, or 4/4/0 with a count. */
export function SectionHeader({
  title,
  count,
  countAccessibilityLabel,
  variant = 'plain',
  tone = 'neutral',
  action,
  style,
  testID,
}: SectionHeaderProps): JSX.Element {
  const theme = useTheme();
  const colored = variant !== 'plain';
  const dotColor =
    tone === 'critical'
      ? theme.color.tone.critical.solid
      : tone === 'warning'
        ? theme.color.tone.warning.solid
        : tone === 'success'
          ? theme.color.tone.success.solid
          : theme.color.text.disabled;
  return (
    <View
      testID={testID ?? 'ui.sectionHeader'}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: theme.space[2],
          paddingTop: count === undefined ? 0 : 4,
          paddingHorizontal: 4,
          paddingBottom: count === undefined ? 8 : 8,
        },
        style,
      ]}
    >
      {variant === 'dot' ? (
        <View
          {...hiddenFromA11y}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: dotColor,
            alignSelf: 'center',
          }}
        />
      ) : null}
      <Text
        variant="kicker"
        tone={colored ? (tone === 'neutral' ? 'secondary' : tone) : 'tertiaryStrong'}
        heading
        style={{ flexShrink: 1 }}
      >
        {title}
      </Text>
      {count === undefined ? null : (
        <Text variant="meta" tone="tertiaryStrong" accessibilityLabel={countAccessibilityLabel}>
          {count}
        </Text>
      )}
      <View style={{ flex: 1 }} />
      {action}
    </View>
  );
}

export const SectionKicker = SectionHeader;

export interface GroupedListProps {
  readonly children: ReactNode;
  /** Rows padding: `4/16` (default) or `0/16`. */
  readonly dense?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Grouped list container: surface, radius 18, `shadow.card`; hairlines between rows. */
export function GroupedList({
  children,
  dense = false,
  style,
  testID,
}: GroupedListProps): JSX.Element {
  const theme = useTheme();
  const rows = Children.toArray(children).filter((child) => isValidElement(child));
  return (
    <View
      testID={testID ?? 'ui.groupedList'}
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.list,
          paddingHorizontal: theme.layout.groupedListPadX,
          paddingVertical: dense ? 0 : theme.layout.groupedListPadY,
        },
        theme.elevation('card'),
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : `row-${String(i)}`}>
          {i > 0 ? <Divider /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export type ListRowTrailing =
  | { readonly kind: 'chevron' }
  | { readonly kind: 'value'; readonly text: string; readonly chevron?: boolean }
  | { readonly kind: 'switch'; readonly value: boolean }
  | { readonly kind: 'check'; readonly checked: boolean }
  | { readonly kind: 'radio'; readonly selected: boolean }
  | { readonly kind: 'link'; readonly text: string }
  | { readonly kind: 'custom'; readonly node: ReactNode };

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Leading 30 tile (neutral) or a bare 20 icon in a 24 slot. */
  readonly icon?: IconName;
  readonly iconStyle?: 'tile' | 'bare';
  readonly trailing?: ListRowTrailing;
  /** Row press: navigation, toggling the switch, or selecting. */
  readonly onPress?: () => void;
  /** Destructive rows: title and icon in `critical/text-strong`. */
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** Reason shown and announced when disabled ("Harici kimlik bilgisi gerekli"). */
  readonly disabledReason?: string;
  /** `settings` 52, `twoLine` 56, `twoLineTrailing` 60; default 50. */
  readonly density?: 'default' | 'settings' | 'twoLine' | 'twoLineTrailing';
  /** Composed label; defaults to "title, subtitle, value". */
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

function rowMinHeight(
  theme: ReturnType<typeof useTheme>,
  density: NonNullable<ListRowProps['density']>,
): number {
  switch (density) {
    case 'settings':
      return theme.layout.rowSettingsMinHeight;
    case 'twoLine':
      return theme.layout.rowTwoLineMinHeight;
    case 'twoLineTrailing':
      return theme.layout.rowTwoLineTrailingMinHeight;
    case 'default':
      return theme.layout.rowMinHeight;
  }
}

function Trailing({
  trailing,
  disabled,
}: {
  readonly trailing: ListRowTrailing;
  readonly disabled: boolean;
}): ReactNode {
  const theme = useTheme();
  switch (trailing.kind) {
    case 'chevron':
      return <Icon name="chevron_right" size={18} color={theme.color.icon.chevron} />;
    case 'value':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text variant="bodyXs" tone="tertiaryStrong" numberOfLines={1}>
            {trailing.text}
          </Text>
          {trailing.chevron === true ? (
            <Icon name="chevron_right" size={18} color={theme.color.icon.chevron} />
          ) : null}
        </View>
      );
    case 'switch':
      return <SwitchTrack value={trailing.value} disabled={disabled} />;
    case 'check':
      return <CheckIndicator selected={trailing.checked} />;
    case 'radio':
      return <RadioIndicator selected={trailing.selected} />;
    case 'link':
      return (
        <Text variant="labelSm" tone="link">
          {trailing.text}
        </Text>
      );
    case 'custom':
      return trailing.node;
  }
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconStyle = 'tile',
  trailing,
  onPress,
  destructive = false,
  disabled = false,
  disabledReason,
  density = 'default',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListRowProps): JSX.Element {
  const theme = useTheme();
  const titleColor = destructive ? theme.tone.critical.text : theme.color.text.primary;
  const valueText =
    trailing?.kind === 'value' || trailing?.kind === 'link' ? trailing.text : undefined;
  const label =
    accessibilityLabel ??
    [title, subtitle, valueText, disabled ? disabledReason : undefined]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(', ');
  const role =
    trailing?.kind === 'switch'
      ? 'switch'
      : trailing?.kind === 'radio'
        ? 'radio'
        : trailing?.kind === 'check'
          ? 'checkbox'
          : 'button';
  const state =
    trailing?.kind === 'switch'
      ? { checked: trailing.value }
      : trailing?.kind === 'radio'
        ? { checked: trailing.selected }
        : trailing?.kind === 'check'
          ? { checked: trailing.checked }
          : undefined;
  const body = (
    <>
      {icon === undefined ? null : iconStyle === 'tile' ? (
        <IconTile icon={icon} size={30} tone={destructive ? 'critical' : 'neutral'} />
      ) : (
        <View style={{ width: 24, alignItems: 'center' }} {...hiddenFromA11y}>
          <Icon
            name={icon}
            size={20}
            color={destructive ? theme.tone.critical.text : theme.color.icon.default}
          />
        </View>
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="rowTitle" style={{ color: titleColor }}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {subtitle}
          </Text>
        )}
        {disabled && disabledReason !== undefined ? (
          <Text variant="meta" tone="tertiaryStrong">
            {disabledReason}
          </Text>
        ) : null}
      </View>
      {trailing === undefined ? null : <Trailing trailing={trailing} disabled={disabled} />}
    </>
  );
  const style: ViewStyle = {
    minHeight: rowMinHeight(theme, density),
    paddingVertical: theme.layout.rowPadY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    opacity: disabled ? theme.opacity.disabled : 1,
  };
  if (onPress === undefined) {
    return (
      <View testID={testID ?? 'ui.listRow'} accessible accessibilityLabel={label} style={style}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID ?? 'ui.listRow'}
      feedback="none"
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={state}
      disabled={disabled}
      haptic={trailing?.kind === 'switch' ? 'select' : undefined}
      onPress={onPress}
      pressedStyle={{ opacity: 0.7 }}
      style={style}
    >
      {body}
    </PressableScale>
  );
}

export interface CategoryRowProps {
  readonly label: string;
  readonly count: string;
  readonly icon: IconName;
  /** Highlighted ("hot") category: primary tile and count. */
  readonly hot?: boolean;
  readonly onPress: () => void;
  /** "Önemli, 3 mail" */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Mail Intelligence category row (4.3): tile 30, label 15/500, count 15/600, chevron. */
export function CategoryRow({
  label,
  count,
  icon,
  hot = false,
  onPress,
  accessibilityLabel,
  testID,
}: CategoryRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.categoryRow'}
      feedback="none"
      accessibilityLabel={accessibilityLabel ?? `${label}, ${count}`}
      onPress={onPress}
      pressedStyle={{ opacity: 0.7 }}
      style={{
        minHeight: theme.layout.rowMinHeight,
        paddingVertical: theme.layout.rowPadY,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
      }}
    >
      <IconTile icon={icon} size={30} tone={hot ? 'primary' : 'neutral'} />
      <Text variant="rowTitle" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant="labelLg"
        numeric
        style={{ color: hot ? theme.color.brand.primary : theme.color.text.secondary }}
      >
        {count}
      </Text>
      <Icon name="chevron_right" size={18} color={theme.color.icon.chevron} />
    </PressableScale>
  );
}

export interface OptionRowProps {
  readonly label: string;
  readonly icon?: IconName;
  /** Right meta ("19:00", "Takvimine göre: 16:30"). */
  readonly meta?: string;
  /** AI option: `auto_awesome` FILL primary, meta 12/600 on-soft. */
  readonly ai?: boolean;
  /** Recommended option: soft background and trailing check. */
  readonly recommended?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Shown as meta and included in the label when disabled. */
  readonly disabledReason?: string;
  /** Single-choice lists use `radio`; action lists use `button`. */
  readonly role?: 'radio' | 'button';
  readonly twoLine?: boolean;
  readonly subtitle?: string;
  readonly testID?: string;
}

/** Sheet option row: min 52 (60 two-line), top hairline, icon 20 in 24, 15/500, meta right. */
export function OptionRow({
  label,
  icon,
  meta,
  ai = false,
  recommended = false,
  selected = false,
  onPress,
  disabled = false,
  disabledReason,
  role = 'button',
  twoLine = false,
  subtitle,
  testID,
}: OptionRowProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const shownMeta = disabled && disabledReason !== undefined ? disabledReason : meta;
  const a11yLabel = [label, subtitle, shownMeta]
    .filter((p): p is string => p !== undefined && p !== '')
    .join(', ');
  return (
    <View>
      <Divider />
      <PressableScale
        testID={testID ?? 'ui.optionRow'}
        feedback="none"
        accessibilityRole={role}
        accessibilityLabel={a11yLabel}
        accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
        disabled={disabled}
        onPress={onPress}
        pressedStyle={{ backgroundColor: c.surfacePressed }}
        style={[
          {
            minHeight: twoLine || subtitle !== undefined ? 60 : 52,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            opacity: disabled ? theme.opacity.disabled : 1,
          },
          recommended
            ? {
                backgroundColor: c.plan.ai,
                borderRadius: theme.radius.inline,
                marginHorizontal: -8,
                paddingHorizontal: 8,
              }
            : null,
        ]}
      >
        {icon === undefined && !ai ? null : (
          <View style={{ width: 24, alignItems: 'center' }} {...hiddenFromA11y}>
            <Icon
              name={ai ? 'auto_awesome' : (icon ?? 'auto_awesome')}
              filled={ai}
              size={20}
              color={ai ? c.icon.ai : c.icon.default}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text variant="rowTitle">{label}</Text>
          {subtitle === undefined ? null : (
            <Text variant="meta" tone="tertiaryStrong">
              {subtitle}
            </Text>
          )}
        </View>
        {shownMeta === undefined ? null : (
          <Text
            variant={ai ? 'labelXs' : 'meta'}
            tone={ai ? 'brand' : 'tertiaryStrong'}
            numberOfLines={1}
          >
            {shownMeta}
          </Text>
        )}
        {recommended || selected ? (
          <Icon name="check_circle" filled size={20} color={c.brand.primary} />
        ) : null}
      </PressableScale>
    </View>
  );
}

export interface ChecklistRowProps {
  readonly label: string;
  readonly state: 'open' | 'done' | 'followUp';
  /** Time meta for done items. */
  readonly meta?: string;
  /** Toggle; announced with the "Tamamlandı olarak işaretle" action label. */
  readonly onToggle?: () => void;
  readonly toggleActionLabel?: string;
  readonly testID?: string;
}

/** Evening/briefing checklist row (3.6): `role=checkbox` with the checked state. */
export function ChecklistRow({
  label,
  state,
  meta,
  onToggle,
  toggleActionLabel,
  testID,
}: ChecklistRowProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const done = state === 'done';
  const icon =
    state === 'followUp' ? (
      <Icon name="schedule_send" size={22} color={c.icon.default} />
    ) : (
      <Icon
        name={done ? 'check_circle' : 'radio_button_unchecked'}
        filled={done}
        size={22}
        color={done ? c.tone.success.solid : c.control.radioOff}
      />
    );
  const content = (
    <>
      {icon}
      <Text
        variant={done ? 'body' : 'rowTitle'}
        tone={done ? 'secondary' : 'primary'}
        strike={done}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
      {meta === undefined ? null : (
        <Text variant="meta" tone="tertiaryStrong" numeric>
          {meta}
        </Text>
      )}
    </>
  );
  const style: ViewStyle = {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
  };
  if (onToggle === undefined || state === 'followUp') {
    return (
      <View testID={testID ?? 'ui.checklistRow'} accessible style={style}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID ?? 'ui.checklistRow'}
      feedback="none"
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: done }}
      accessibilityActions={
        toggleActionLabel === undefined
          ? undefined
          : [{ name: 'activate', label: toggleActionLabel }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') onToggle();
      }}
      haptic={done ? undefined : 'complete'}
      onPress={onToggle}
      style={style}
    >
      {content}
    </PressableScale>
  );
}

export interface TimelineRowProps {
  readonly time: string;
  readonly title: string;
  readonly status?: string;
  readonly statusTone?: Extract<StatusTone, 'critical' | 'warning' | 'success' | 'neutral'>;
  readonly testID?: string;
}

/** Briefing timeline row (3.5): time 44w 13/600, title 15/500, status 12/600 in tone. */
export function TimelineRow({
  time,
  title,
  status,
  statusTone = 'neutral',
  testID,
}: TimelineRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.timelineRow'}
      accessible
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[3], minHeight: 36 }}
    >
      <Text variant="labelSm" tone="secondary" numeric style={{ width: 44 }}>
        {time}
      </Text>
      <Text variant="rowTitle" style={{ flex: 1 }}>
        {title}
      </Text>
      {status === undefined ? null : (
        <Text variant="labelXs" tone={statusTone === 'neutral' ? 'secondary' : statusTone}>
          {status}
        </Text>
      )}
    </View>
  );
}

export interface KeyValueItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Tappable value (e.g. "Kaynak" → source). */
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
}

export interface KeyValueGridProps {
  readonly items: readonly KeyValueItem[];
  /** Label column: 64 (approval, default), 52 (commitments), 56 (capture rows). */
  readonly labelWidth?: 52 | 56 | 64;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Key/value grid: `64px 1fr`, gap 6/10, `bodyXs`; each row reads "Neden: …". */
export function KeyValueGrid({
  items,
  labelWidth = 64,
  style,
  testID,
}: KeyValueGridProps): JSX.Element {
  const theme = useTheme();
  return (
    <View testID={testID ?? 'ui.keyValueGrid'} style={[{ gap: 6 }, style]}>
      {items.map((item) => {
        const row = (
          <>
            <Text variant="bodyXs" tone="tertiaryStrong" style={{ width: labelWidth }}>
              {item.label}
            </Text>
            <Text
              variant="bodyXs"
              tone={item.onPress === undefined ? 'primary' : 'link'}
              style={{ flex: 1 }}
            >
              {item.value}
            </Text>
          </>
        );
        const rowStyle: ViewStyle = { flexDirection: 'row', columnGap: theme.space[2.5] };
        return item.onPress === undefined ? (
          <View
            key={item.key}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
            style={rowStyle}
          >
            {row}
          </View>
        ) : (
          <PressableScale
            key={item.key}
            testID={`ui.keyValueGrid.${item.key}`}
            feedback="none"
            accessibilityRole="link"
            accessibilityLabel={`${item.label}: ${item.value}`}
            accessibilityHint={item.accessibilityHint}
            onPress={item.onPress}
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
            style={rowStyle}
          >
            {row}
          </PressableScale>
        );
      })}
    </View>
  );
}
