/**
 * Chips (DESIGN_AUDIT §3.3). Rule (verbatim): "Filtre çipi: 34 yüksek, seçili = ink zemin. Meta
 * çipi: 30 yüksek, ikon 15." Selection chips animate their colours over 150 ms (instant under
 * reduce motion) and give a selection haptic; every chip grows to the 44/48 hit target.
 */
import type { JSX, ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale, type PressableA11yProps } from '../../primitives/PressableScale.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useSelectionBackground } from '../../primitives/useSelectionBackground.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';

export interface FilterChipProps extends PressableA11yProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  /** The container the chip sits on; the unselected fill contrasts with it. Default `bg`. */
  readonly on?: 'bg' | 'surface';
  /** Memory-search variant: 30 h, padding 0/10, 12 px. */
  readonly compact?: boolean;
  /** `tab` inside a view-filter tab list (default) or `radio` inside a radio group. */
  readonly role?: 'tab' | 'radio';
  readonly disabled?: boolean;
}

export function FilterChip({
  label,
  selected,
  onPress,
  on = 'bg',
  compact = false,
  role = 'tab',
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: FilterChipProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const height = compact ? 30 : 34;
  const background = useSelectionBackground(selected, on === 'bg' ? c.surface : c.bg, c.inverse.bg);
  const fg = selected ? c.inverse.text : c.text.secondary;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.filterChip.${selected ? 'selected' : 'default'}`}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      visualSize={{ width: 44, height }}
      animatedStyle={background}
      style={{
        minHeight: height,
        paddingHorizontal: compact ? 10 : 14,
        borderRadius: theme.radius.pill,
        justifyContent: 'center',
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      <Text variant={compact ? 'labelXs' : 'labelSm'} style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface FilterChipRowItem {
  readonly key: string;
  readonly label: string;
  readonly accessibilityLabel?: string;
}

export interface FilterChipRowProps {
  readonly items: readonly FilterChipRowItem[];
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
  /** `tabs` for view filters (tablist/tab), `radio` for value pickers (radiogroup/radio). */
  readonly semantics?: 'tabs' | 'radio';
  readonly compact?: boolean;
  readonly on?: 'bg' | 'surface';
  /** Label of the group for screen readers. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Horizontal chip row: edge padding 20, gap 8 (6 compact). */
export function FilterChipRow({
  items,
  selectedKey,
  onSelect,
  semantics = 'tabs',
  compact = false,
  on = 'bg',
  accessibilityLabel,
  testID,
}: FilterChipRowProps): JSX.Element {
  const theme = useTheme();
  const l = theme.layout.chipRow;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID={testID ?? 'ui.filterChipRow'}
      accessibilityRole={semantics === 'tabs' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={{
        paddingHorizontal: l.edge,
        gap: compact ? l.gapCompact : l.gap,
        alignItems: 'center',
      }}
    >
      {items.map((item) => (
        <FilterChip
          key={item.key}
          label={item.label}
          accessibilityLabel={item.accessibilityLabel}
          selected={item.key === selectedKey}
          onPress={() => {
            if (item.key !== selectedKey) onSelect(item.key);
          }}
          compact={compact}
          on={on}
          role={semantics === 'tabs' ? 'tab' : 'radio'}
          testID={`ui.filterChip.${item.key}`}
        />
      ))}
    </ScrollView>
  );
}

export type MetaChipVariant = 'neutral' | 'vip' | 'warning' | 'surface';

export interface MetaChipProps extends PressableA11yProps {
  readonly label: string;
  readonly icon?: IconName;
  readonly variant?: MetaChipVariant;
  /** Editable chips open a picker ("Tarihi düzenle: 12 Eylül"). */
  readonly onPress?: () => void;
  readonly iconFilled?: boolean;
}

function metaColors(theme: ReturnType<typeof useTheme>, variant: MetaChipVariant) {
  switch (variant) {
    case 'vip':
      return {
        bg: theme.tone.primary.soft,
        fg: theme.tone.primary.text,
        icon: theme.tone.primary.text,
      };
    case 'warning':
      return {
        bg: theme.tone.warning.soft,
        fg: theme.tone.warning.text,
        icon: theme.tone.warning.icon,
      };
    case 'surface':
      return {
        bg: theme.color.surface,
        fg: theme.color.text.secondary,
        icon: theme.color.icon.default,
      };
    case 'neutral':
      return {
        bg: theme.tone.neutral.soft,
        fg: theme.tone.neutral.text,
        icon: theme.tone.neutral.icon,
      };
  }
}

/** 30 h meta chip, padding 0/10, 12/600, icon 15, gap 4. */
export function MetaChip({
  label,
  icon,
  variant = 'neutral',
  onPress,
  iconFilled,
  testID,
  accessibilityLabel,
  ...a11y
}: MetaChipProps): JSX.Element {
  const theme = useTheme();
  const colors = metaColors(theme, variant);
  const filled = iconFilled ?? (variant === 'vip' && icon === 'star');
  const body = (
    <>
      {icon === undefined ? null : (
        <Icon name={icon} size={15} color={colors.icon} filled={filled} />
      )}
      <Text variant="labelXs" style={{ color: colors.fg }} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const style: ViewStyle = {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.space[1],
    backgroundColor: colors.bg,
  };
  const elevation = variant === 'surface' ? theme.elevation('s1') : null;
  if (onPress === undefined) {
    return (
      <View testID={testID ?? `ui.metaChip.${variant}`} style={[style, elevation]}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.metaChip.${variant}`}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      visualSize={{ width: 44, height: 30 }}
      pressedStyle={{ backgroundColor: theme.color.surfacePressed }}
      style={[style, elevation]}
    >
      {body}
    </PressableScale>
  );
}

export type ConnectState = 'connect' | 'connected' | 'connecting' | 'needsReauth' | 'error';

export interface ConnectPillProps extends PressableA11yProps {
  readonly state: ConnectState;
  /** Visible label for the state ("Bağla", "Bağlandı", "Bağlanıyor…", "Yeniden bağlan", "Hata"). */
  readonly label: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
}

const CONNECT_ICON: Record<ConnectState, IconName | undefined> = {
  connect: 'add',
  connected: 'check',
  connecting: undefined,
  needsReauth: 'link_off',
  error: 'error',
};

/** 34 h integration status pill (2.6). */
export function ConnectPill({
  state,
  label,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: ConnectPillProps): JSX.Element {
  const theme = useTheme();
  const tone =
    state === 'connected'
      ? theme.tone.success
      : state === 'needsReauth' || state === 'error'
        ? theme.tone.critical
        : theme.tone.primary;
  const icon = CONNECT_ICON[state];
  const content = (
    <>
      {state === 'connecting' ? <Spinner size={14} tone="onSoft" /> : null}
      {icon === undefined ? null : <Icon name={icon} size={16} color={tone.text} />}
      <Text variant="labelSm" style={{ color: tone.text }} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const style: ViewStyle = {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1],
    backgroundColor: tone.soft,
    opacity: disabled ? theme.opacity.disabled : 1,
  };
  if (onPress === undefined || state === 'connected') {
    return (
      <View testID={testID ?? `ui.connectPill.${state}`} style={style}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.connectPill.${state}`}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      busy={state === 'connecting'}
      visualSize={{ width: 44, height: 34 }}
      style={style}
    >
      {content}
    </PressableScale>
  );
}

export type AssistChipTone = 'neutral' | 'soft' | 'selected' | 'surface';

export interface AssistChipProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: IconName;
  readonly tone?: AssistChipTone;
  readonly disabled?: boolean;
}

/** 30 h assist / suggestion chip (reply tools "Kısalt", prompt suggestions). */
export function AssistChip({
  label,
  onPress,
  icon,
  tone = 'neutral',
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: AssistChipProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const colors =
    tone === 'soft'
      ? { bg: theme.tone.primary.soft, fg: theme.tone.primary.text }
      : tone === 'selected'
        ? { bg: c.inverse.bg, fg: c.inverse.text }
        : tone === 'surface'
          ? { bg: c.surface, fg: c.text.secondary }
          : { bg: theme.tone.neutral.soft, fg: theme.tone.neutral.text };
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.assistChip.${tone}`}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={tone === 'selected' ? { selected: true } : undefined}
      onPress={onPress}
      disabled={disabled}
      visualSize={{ width: 44, height: 30 }}
      pressedStyle={{ backgroundColor: c.surfacePressed }}
      style={[
        {
          minHeight: 30,
          paddingHorizontal: 10,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          backgroundColor: colors.bg,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        tone === 'surface' ? theme.elevation('s1') : null,
      ]}
    >
      {icon === undefined ? null : <Icon name={icon} size={15} color={colors.fg} />}
      <Text variant="labelXs" style={{ color: colors.fg }} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Alias used by the screen maps (prompt suggestions). */
export const SuggestionChip = AssistChip;

export interface TokenChipProps {
  readonly label: string;
  /** Removes the token; required unless `variant="add"`. */
  readonly onRemove?: () => void;
  /** Label of the remove button ("“teklif” kelimesini kaldır"). */
  readonly removeLabel?: string;
  /** `add`: the dashed "input-to-be" chip that opens the entry. */
  readonly variant?: 'token' | 'add';
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** 34 h keyword token (7.11) with a trailing remove button, or the dashed "add" chip. */
export function TokenChip({
  label,
  onRemove,
  removeLabel,
  variant = 'token',
  onPress,
  testID,
}: TokenChipProps): JSX.Element {
  const theme = useTheme();
  const tone = theme.tone.primary;
  if (variant === 'add') {
    return (
      <PressableScale
        testID={testID ?? 'ui.tokenChip.add'}
        accessibilityLabel={label}
        onPress={onPress}
        visualSize={{ width: 44, height: 34 }}
        style={{
          minHeight: 34,
          paddingHorizontal: 12,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.color.icon.chevron,
        }}
      >
        <Icon name="add" size={16} color={theme.color.text.secondary} />
        <Text variant="labelSm" tone="secondary">
          {label}
        </Text>
      </PressableScale>
    );
  }
  return (
    <View
      testID={testID ?? 'ui.tokenChip'}
      style={{
        minHeight: 34,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: theme.radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        backgroundColor: tone.soft,
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="labelSm" style={{ color: tone.text }}>
        {label}
      </Text>
      {onRemove === undefined ? null : (
        <PressableScale
          testID={`${testID ?? 'ui.tokenChip'}.remove`}
          accessibilityLabel={removeLabel ?? label}
          onPress={onRemove}
          visualSize={{ width: 24, height: 24 }}
          style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={16} color={tone.text} />
        </PressableScale>
      )}
    </View>
  );
}

export interface ChoiceChipProps extends PressableA11yProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  /** Container: `surface` (unselected = bg fill) or `bg` (unselected = surface + shadow). */
  readonly on?: 'surface' | 'bg';
  readonly icon?: IconName;
}

/** 30 h single-choice chip (2.7c providers, 4.13c types); `role=radio`. */
export function ChoiceChip({
  label,
  selected,
  onPress,
  on = 'surface',
  icon,
  testID,
  accessibilityLabel,
  ...a11y
}: ChoiceChipProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const bg = selected ? c.inverse.bg : on === 'surface' ? c.bg : c.surface;
  const fg = selected ? c.inverse.text : c.text.secondary;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.choiceChip.${selected ? 'selected' : 'default'}`}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      haptic="select"
      visualSize={{ width: 44, height: 30 }}
      style={[
        {
          minHeight: 30,
          paddingHorizontal: 10,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          backgroundColor: bg,
        },
        !selected && on === 'bg' ? theme.elevation('s1') : null,
      ]}
    >
      {selected ? <Icon name="check" size={14} color={fg} /> : null}
      {icon === undefined ? null : <Icon name={icon} size={15} color={fg} />}
      <Text variant="labelXs" style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface SourceChipProps extends PressableA11yProps {
  readonly label: string;
  readonly icon: IconName;
  /** Opens the source. */
  readonly onPress: () => void;
}

/** KAYNAKLAR chip: 30 h surface, 12/500, icon 15 secondary, `shadow.s1`. */
export function SourceChip({
  label,
  icon,
  onPress,
  testID,
  accessibilityLabel,
  ...a11y
}: SourceChipProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? 'ui.sourceChip'}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      visualSize={{ width: 44, height: 30 }}
      pressedStyle={{ backgroundColor: theme.color.surfacePressed }}
      style={[
        {
          minHeight: 30,
          paddingHorizontal: 10,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          backgroundColor: theme.color.surface,
        },
        theme.elevation('s1'),
      ]}
    >
      <Icon name={icon} size={15} color={theme.color.icon.default} />
      <Text variant="meta" weight={500} tone="secondary" numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface FollowUpChipProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
}

/** 30 h surface follow-up question chip (12/600 secondary). */
export function FollowUpChip({ label, onPress, testID, ...a11y }: FollowUpChipProps): JSX.Element {
  return (
    <AssistChip
      {...a11y}
      label={label}
      onPress={onPress}
      tone="surface"
      testID={testID ?? 'ui.followUpChip'}
    />
  );
}

export interface VoicePromptChipProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
}

/** 36 h translucent prompt chip on the night gradient (13/500 white). */
export function VoicePromptChip({
  label,
  onPress,
  testID,
  accessibilityLabel,
  ...a11y
}: VoicePromptChipProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? 'ui.voicePromptChip'}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      visualSize={{ width: 44, height: 36 }}
      pressedStyle={{ backgroundColor: theme.color.onGradient.fill18 }}
      style={{
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: theme.radius.pill,
        justifyContent: 'center',
        backgroundColor: theme.color.onGradient.fill12,
      }}
    >
      <Text variant="bodyXs" weight={500} tone="onGradient" numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface RecipientChipProps {
  readonly name: string;
  readonly id?: string;
  /** Optional trailing detail (subject, address). */
  readonly detail?: string;
  readonly testID?: string;
}

/** 30 h recipient chip with a 22 avatar (AI reply header). */
export function RecipientChip({ name, id, detail, testID }: RecipientChipProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.recipientChip'}
      accessible
      accessibilityLabel={detail === undefined ? name : `${name}, ${detail}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}
    >
      <View
        style={{
          minHeight: 30,
          paddingLeft: 4,
          paddingRight: 10,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1.5],
          backgroundColor: theme.color.surfaceSunken,
        }}
      >
        <Avatar name={name} id={id} size={22} decorative />
        <Text variant="labelXs">{name}</Text>
      </View>
      {detail === undefined ? null : (
        <Text variant="meta" tone="tertiaryStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {detail}
        </Text>
      )}
    </View>
  );
}

export interface ChipWrapProps {
  readonly children: ReactNode;
  readonly gap?: number;
  readonly style?: StyleProp<ViewStyle>;
}

/** Wrapping chip layout (extracted fields, keywords, source chips). */
export function ChipWrap({ children, gap = 8, style }: ChipWrapProps): JSX.Element {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}
