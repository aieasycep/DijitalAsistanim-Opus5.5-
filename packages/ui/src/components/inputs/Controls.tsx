/**
 * Selection controls (DESIGN_AUDIT §3.8):
 * - `Switch`: 50×30 r15; on = primary with the knob right; off = `switchOff` + 1 px
 *   `switchOffBorder` ring (DEV-08, WCAG 1.4.11); knob 26 r13 with `shadow.knob`; 150 ms slide.
 *   Disabled .4 without the knob shadow. Inside a row the whole row is the target (`ListRow`).
 * - `SegmentedControl`: track pill padding 3; 32 h segments (30 compact, 34 retention); selected
 *   thumb surface/ink + `shadow.segmentThumb` (dark: inverse), sliding 150 ms; unselected
 *   `secondaryOnTrack` (DEV-05). `tablist` for view switches, `radiogroup` for values.
 * - `RadioIndicator` / `CheckIndicator`: selected `check_circle` FILL primary, empty
 *   `radio_button_unchecked` in `control.radioOff` (DEV-07), completed FILL success.
 */
import { useEffect, useState, type JSX } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Icon } from '../../icons/Icon.tsx';
import { PressableScale, type PressableA11yProps } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useMotion } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export interface SwitchTrackProps {
  readonly value: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** The visual switch (no touch handling); used standalone by `Switch` and inside switch rows. */
export function SwitchTrack({ value, disabled = false, testID }: SwitchTrackProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const c = theme.color.control;
  const offset = useSharedValue(value ? 20 : 0);
  useEffect(() => {
    offset.set(motionControl.animate(value ? 20 : 0, theme.motion.duration.chip));
  }, [value, motionControl, offset, theme.motion.duration.chip]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  return (
    <View
      testID={testID}
      {...hiddenFromA11y}
      style={{
        width: 50,
        height: 30,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: value ? c.switchOn : c.switchOffBorder,
        backgroundColor: value ? c.switchOn : c.switchOff,
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 1,
            left: 1,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: c.knob,
          },
          disabled ? null : theme.elevation('knob'),
          knob,
        ]}
      />
    </View>
  );
}

export interface SwitchProps extends PressableA11yProps {
  readonly value: boolean;
  readonly onValueChange: (next: boolean) => void;
  /** Required when the switch is not inside a labelled row. */
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
}

export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  testID,
  ...a11y
}: SwitchProps): JSX.Element {
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? 'ui.switch'}
      feedback="none"
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      disabled={disabled}
      haptic="select"
      visualSize={{ width: 50, height: 30 }}
      onPress={() => {
        onValueChange(!value);
      }}
    >
      <SwitchTrack value={value} disabled={disabled} />
    </PressableScale>
  );
}

export interface SegmentedOption {
  readonly key: string;
  readonly label: string;
  readonly accessibilityLabel?: string;
}

export interface SegmentedControlProps {
  readonly options: readonly SegmentedOption[];
  readonly selectedKey: string;
  readonly onChange: (key: string) => void;
  /** `tabs` for view switches (Gün/Hafta), `radio` for values (tone, retention). */
  readonly semantics?: 'tabs' | 'radio';
  /** 30 (compact), 32 (default) or 34 (retention). */
  readonly size?: 30 | 32 | 34;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function SegmentedControl({
  options,
  selectedKey,
  onChange,
  semantics = 'radio',
  size = 32,
  accessibilityLabel,
  disabled = false,
  style,
  testID,
}: SegmentedControlProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const c = theme.color;
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.key === selectedKey),
  );
  const segmentWidth = options.length === 0 ? 0 : (trackWidth - 6) / options.length;
  const x = useSharedValue(index * segmentWidth);
  useEffect(() => {
    x.set(motionControl.animate(index * segmentWidth, theme.motion.duration.chip));
  }, [index, segmentWidth, motionControl, x, theme.motion.duration.chip]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const thumbBg = theme.isDark ? c.inverse.bg : c.surface;
  const selectedText = theme.isDark ? c.inverse.text : c.text.primary;
  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next !== trackWidth) setTrackWidth(next);
  };
  return (
    <View
      testID={testID ?? 'ui.segmentedControl'}
      accessibilityRole={semantics === 'tabs' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      style={[
        {
          flexDirection: 'row',
          padding: 3,
          borderRadius: theme.radius.pill,
          backgroundColor: c.surfaceTrack,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        style,
      ]}
    >
      {trackWidth > 0 ? (
        <Animated.View
          {...hiddenFromA11y}
          style={[
            {
              position: 'absolute',
              top: 3,
              left: 3,
              width: segmentWidth,
              height: size,
              borderRadius: theme.radius.pill,
              backgroundColor: thumbBg,
            },
            theme.elevation('segmentThumb'),
            thumb,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.key === selectedKey;
        return (
          <PressableScale
            key={option.key}
            testID={`ui.segmentedControl.${option.key}`}
            feedback="none"
            accessibilityRole={semantics === 'tabs' ? 'tab' : 'radio'}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={semantics === 'tabs' ? { selected } : { checked: selected }}
            disabled={disabled}
            haptic={selected ? undefined : 'select'}
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            onPress={() => {
              if (!selected) onChange(option.key);
            }}
            style={{
              flex: 1,
              minHeight: size,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: selected && trackWidth === 0 ? thumbBg : undefined,
            }}
          >
            <Text
              variant="labelSm"
              style={{ color: selected ? selectedText : c.text.secondaryOnTrack }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export interface SelectionIndicatorProps {
  readonly selected: boolean;
  /** 22 in rows (default), 24 in selection lists, 20 on plan cards. */
  readonly size?: 20 | 22 | 24;
  readonly testID?: string;
}

/** Radio indicator (part of its row's semantics; hidden itself). */
export function RadioIndicator({
  selected,
  size = 22,
  testID,
}: SelectionIndicatorProps): JSX.Element {
  const theme = useTheme();
  return (
    <View testID={testID ?? 'ui.radioIndicator'} {...hiddenFromA11y}>
      <Icon
        name={selected ? 'check_circle' : 'radio_button_unchecked'}
        filled={selected}
        size={size}
        color={selected ? theme.color.brand.primary : theme.color.control.radioOff}
      />
    </View>
  );
}

export interface CheckIndicatorProps extends SelectionIndicatorProps {
  /** `done` = completed (success) instead of selected (primary). */
  readonly variant?: 'selected' | 'done';
}

/** Check indicator: selected (primary) or completed (success); empty ring otherwise. */
export function CheckIndicator({
  selected,
  size = 22,
  variant = 'selected',
  testID,
}: CheckIndicatorProps): JSX.Element {
  const theme = useTheme();
  const on = variant === 'done' ? theme.color.tone.success.solid : theme.color.brand.primary;
  return (
    <View testID={testID ?? 'ui.checkIndicator'} {...hiddenFromA11y}>
      <Icon
        name={selected ? 'check_circle' : 'radio_button_unchecked'}
        filled={selected}
        size={size}
        color={selected ? on : theme.color.control.radioOff}
      />
    </View>
  );
}
