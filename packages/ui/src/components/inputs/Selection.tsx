/**
 * Selection surfaces and layout helpers (DESIGN_AUDIT §3.8, §3.13, §3.9):
 * `TimeChip` (2.9), `PlanOptionCard` (7.5), `SelectableTile` (2.8), `ThemePreviewTile` (7.8),
 * `Accordion` ("Orijinal Mail" expander: height 280 ms, chevron 200 ms), `StickyCTABar`.
 */
import { useEffect, type JSX, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { GradientFill } from '../../primitives/GradientFill.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { SkeletonBlock } from '../../primitives/Skeleton.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useMotion } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Badge } from '../badges/Badge.tsx';

export interface TimeChipProps {
  /** "08:00" (tabular). */
  readonly value: string;
  /** Opens the native 24 h time picker. */
  readonly onPress: () => void;
  /** "Sabah brifingi saati 08:00, değiştir" */
  readonly accessibilityLabel: string;
  /** Free plan: `lock` 16 + .55 opacity; pressing opens the gate. */
  readonly locked?: boolean;
  readonly testID?: string;
}

export function TimeChip({
  value,
  onPress,
  accessibilityLabel,
  locked = false,
  testID,
}: TimeChipProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.timeChip'}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      visualSize={{ width: 64, height: 36 }}
      pressedStyle={{ backgroundColor: theme.color.surfaceSunken }}
      style={{
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: theme.radius.inline,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: theme.color.bg,
        opacity: locked ? 0.55 : 1,
      }}
    >
      {locked ? <Icon name="lock" size={16} color={theme.color.text.secondary} /> : null}
      <Text variant="h3" numeric>
        {value}
      </Text>
    </PressableScale>
  );
}

export interface PlanOptionCardProps {
  readonly title: string;
  /** Store `priceString` line ("₺499,99 / yıl · ayda ₺41,67"). */
  readonly priceLine?: string;
  /** "En avantajlı" */
  readonly badge?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  /** Offerings not loaded yet: price skeleton. */
  readonly loading?: boolean;
  /** Not purchasable (reason in the price line). */
  readonly unavailable?: boolean;
  readonly testID?: string;
}

/** Paywall plan option: r16 padding 14/16, 2 px primary border when selected; `role=radio`. */
export function PlanOptionCard({
  title,
  priceLine,
  badge,
  selected,
  onPress,
  loading = false,
  unavailable = false,
  testID,
}: PlanOptionCardProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <PressableScale
      testID={testID ?? `ui.planOptionCard.${selected ? 'selected' : 'default'}`}
      feedback="card"
      accessibilityRole="radio"
      accessibilityLabel={[title, badge, priceLine].filter(Boolean).join(', ')}
      accessibilityState={{ checked: selected }}
      disabled={unavailable}
      haptic="select"
      onPress={onPress}
      style={{
        borderRadius: theme.radius.cardSm,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 2,
        borderColor: selected ? c.brand.primary : c.border.strong,
        backgroundColor: c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: unavailable ? theme.opacity.disabled : 1,
      }}
    >
      <View
        {...hiddenFromA11y}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? c.brand.primary : c.border.control,
          backgroundColor: selected ? c.brand.primary : undefined,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.text.onPrimary }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="rowTitle" weight={600}>
            {title}
          </Text>
          {badge === undefined ? null : <Badge label={badge} category="approved" />}
        </View>
        {loading ? (
          <SkeletonBlock width={140} height={12} />
        ) : priceLine === undefined ? null : (
          <Text variant="bodyXs" tone="secondary">
            {priceLine}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

export interface SelectableTileProps {
  readonly label: string;
  readonly icon: IconName;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}

/** Onboarding interest tile (2.8): 88 min, r18, selected ink with glow icon; `role=checkbox`. */
export function SelectableTile({
  label,
  icon,
  selected,
  onPress,
  testID,
}: SelectableTileProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <PressableScale
      testID={testID ?? `ui.selectableTile.${selected ? 'selected' : 'default'}`}
      feedback="card"
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      haptic="select"
      onPress={onPress}
      style={[
        {
          flex: 1,
          minHeight: 88,
          borderRadius: theme.radius.list,
          padding: 14,
          justifyContent: 'space-between',
          backgroundColor: selected ? c.inverse.bg : c.surface,
        },
        selected ? null : theme.elevation('card'),
      ]}
    >
      <Icon name={icon} size={24} color={selected ? c.brand.glow : c.icon.ai} />
      <Text
        variant="rowTitle"
        weight={600}
        style={{ color: selected ? c.inverse.text : c.text.primary }}
      >
        {label}
      </Text>
      {selected ? (
        <View style={{ position: 'absolute', top: 12, right: 12 }}>
          <Icon name="check_circle" filled size={20} color={c.inverse.text} />
        </View>
      ) : null}
    </PressableScale>
  );
}

export interface ThemePreviewTileProps {
  readonly label: string;
  readonly mode: 'light' | 'dark' | 'system';
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}

/** Appearance tile (7.8): 120 h r16, primary border when selected; light / dark / split preview. */
export function ThemePreviewTile({
  label,
  mode,
  selected,
  onPress,
  testID,
}: ThemePreviewTileProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  // The swatches show both schemes whichever is active: the page background and its inverse.
  const previewLight = theme.isDark ? c.inverse.bg : c.bg;
  const previewDark = theme.isDark ? c.bg : c.inverse.bg;
  return (
    <PressableScale
      testID={testID ?? `ui.themePreviewTile.${mode}`}
      feedback="card"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      haptic="select"
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 120,
        borderRadius: theme.radius.cardSm,
        padding: 10,
        gap: 8,
        borderWidth: 2,
        borderColor: selected ? c.brand.primary : c.border.hairline,
        backgroundColor: c.surface,
      }}
    >
      <View
        {...hiddenFromA11y}
        style={{ flex: 1, flexDirection: 'row', borderRadius: 10, overflow: 'hidden' }}
      >
        {mode === 'dark' ? null : <View style={{ flex: 1, backgroundColor: previewLight }} />}
        {mode === 'light' ? null : <View style={{ flex: 1, backgroundColor: previewDark }} />}
      </View>
      <Text
        variant="bodyXs"
        weight={selected ? 600 : 500}
        tone={selected ? 'primary' : 'secondary'}
        align="center"
      >
        {label}
      </Text>
    </PressableScale>
  );
}

export interface AccordionProps {
  readonly title: string;
  readonly icon?: IconName;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
  readonly testID?: string;
}

/** In-place expander ("Orijinal Mail"): r18 card, 52 h header, chevron rotates 200 ms. */
export function Accordion({
  title,
  icon,
  expanded,
  onToggle,
  children,
  testID,
}: AccordionProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const rotation = useSharedValue(expanded ? 180 : 0);
  useEffect(() => {
    rotation.set(motionControl.animate(expanded ? 180 : 0, theme.motion.duration.chevron));
  }, [expanded, motionControl, rotation, theme.motion.duration.chevron]);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(rotation.get())}deg` }],
  }));
  return (
    <Card testID={testID ?? 'ui.accordion'} radius="list" padding={0}>
      <PressableScale
        testID="ui.accordion.header"
        feedback="none"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={{
          minHeight: 52,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {icon === undefined ? null : (
          <Icon name={icon} size={20} color={theme.color.icon.default} />
        )}
        <Text variant="rowTitle" weight={600} style={{ flex: 1 }}>
          {title}
        </Text>
        <Animated.View style={chevron}>
          <Icon name="expand_more" size={22} color={theme.color.text.tertiaryStrong} />
        </Animated.View>
      </PressableScale>
      {expanded ? (
        <View
          style={{ borderTopWidth: 1, borderTopColor: theme.color.border.hairline, padding: 16 }}
        >
          {children}
        </View>
      ) : null}
    </Card>
  );
}

export interface StickyCTABarProps {
  readonly children: ReactNode;
  /** Fade-to-background above the bar (default true). */
  readonly fade?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly onHeight?: (height: number) => void;
  readonly testID?: string;
}

/** Sticky footer: padding 16/20/(insets.bottom + 10, min 20) on the page background. */
export function StickyCTABar({
  children,
  fade = true,
  style,
  onHeight,
  testID,
}: StickyCTABarProps): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pad = theme.layout.stickyFooterPad;
  return (
    <View
      testID={testID ?? 'ui.stickyCtaBar'}
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
      style={[
        {
          paddingTop: pad[0],
          paddingHorizontal: pad[1],
          paddingBottom: Math.max(insets.bottom + pad[2], theme.layout.stickyFooterMinBottom),
          gap: theme.layout.buttonRowGap,
          backgroundColor: theme.color.bg,
        },
        style,
      ]}
    >
      {fade ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: -24, left: 0, right: 0, height: 24 }}
        >
          <GradientFill gradient={theme.gradients.fadeToBg} />
        </View>
      ) : null}
      {children}
    </View>
  );
}
