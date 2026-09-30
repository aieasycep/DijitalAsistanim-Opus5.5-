/**
 * `PressableScale` (DESIGN_AUDIT §3.0): the base of every pressable in the kit.
 * - Press feedback: scale .97 (buttons) / .98 (cards) over 120 ms with the standard curve plus the
 *   pressed tone (`pressedStyle`); no Android ripple, no click sound. Reduce motion keeps the tone
 *   change and drops the scale.
 * - Hit target: `hitSlop` grows the visual size to 44 pt (iOS) / 48 dp (Android).
 * - Keyboard focus (Android, iPad): a visible 2 px focus ring (`border.focus`).
 * - Accessibility: role, label, hint, state (disabled / selected / checked / busy), value and
 *   actions pass through; disabled and busy block presses.
 */
import { useState, type JSX, type ReactNode } from 'react';
import {
  Pressable,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityRole,
  type AccessibilityState,
  type AccessibilityValue,
  type GestureResponderEvent,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { hitSlopFor } from '../theme/a11y.ts';
import type { HapticEvent, HapticKind } from '../theme/haptics.ts';
import { useHaptic, useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The handle returned by `useAnimatedStyle` (Reanimated does not export its name). */
export type AnimatedViewStyle = ReturnType<typeof useAnimatedStyle>;

export interface PressableA11yProps {
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly accessibilityRole?: AccessibilityRole;
  readonly accessibilityState?: AccessibilityState;
  readonly accessibilityValue?: AccessibilityValue;
  readonly accessibilityActions?: readonly AccessibilityActionInfo[];
  readonly onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  readonly accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  readonly testID?: string;
}

export interface PressableScaleProps extends PressableA11yProps {
  readonly onPress?: (event: GestureResponderEvent) => void;
  readonly onLongPress?: (event: GestureResponderEvent) => void;
  readonly disabled?: boolean;
  /** Busy (loading): announced and blocks presses. */
  readonly busy?: boolean;
  /** Scale while pressed: `button` .97, `card` .98, `none` 1. */
  readonly feedback?: 'button' | 'card' | 'none';
  /** Style while pressed (the darker pressed tone). */
  readonly pressedStyle?: StyleProp<ViewStyle>;
  readonly style?: StyleProp<ViewStyle>;
  /** An animated style from `useAnimatedStyle` (e.g. the selection colour transition). */
  readonly animatedStyle?: AnimatedViewStyle;
  /** Visual size used to compute `hitSlop` up to the platform minimum. */
  readonly visualSize?: { readonly width: number; readonly height: number };
  readonly hitSlop?: Insets;
  /** Haptic on press (selection controls only; "asla dekor için"). */
  readonly haptic?: HapticEvent | HapticKind;
  /** Show the keyboard focus ring (default true). */
  readonly focusRing?: boolean;
  readonly children?: ReactNode;
}

export function PressableScale({
  onPress,
  onLongPress,
  disabled = false,
  busy = false,
  feedback = 'button',
  pressedStyle,
  style,
  animatedStyle: extraAnimatedStyle,
  visualSize,
  hitSlop,
  haptic,
  focusRing = true,
  accessibilityRole = 'button',
  accessibilityState,
  children,
  ...a11y
}: PressableScaleProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const fire = useHaptic();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const inactive = disabled || busy;
  // Reduce motion keeps the pressed tone and drops the scale entirely.
  const target =
    feedback === 'none' || motionControl.reduceMotion
      ? 1
      : feedback === 'card'
        ? theme.motion.scale.cardPressed
        : theme.motion.scale.buttonPressed;
  const slop =
    hitSlop ?? (visualSize ? hitSlopFor(visualSize.width, visualSize.height) : undefined);
  return (
    <AnimatedPressable
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: inactive, busy }}
      {...a11y}
      disabled={inactive}
      hitSlop={slop}
      android_disableSound
      onPress={
        onPress === undefined
          ? undefined
          : (event) => {
              if (haptic !== undefined) fire(haptic);
              onPress(event);
            }
      }
      onLongPress={onLongPress}
      onPressIn={() => {
        setPressed(true);
        scale.set(motionControl.animate(target, theme.motion.duration.press));
      }}
      onPressOut={() => {
        setPressed(false);
        scale.set(motionControl.animate(1, theme.motion.duration.press));
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={[
        style,
        pressed ? pressedStyle : null,
        focusRing && focused ? theme.elevation('focusRing') : null,
        extraAnimatedStyle,
        animatedStyle,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
