/**
 * Skeletons (DESIGN_AUDIT §3.9, M-STATE-01): blocks at real card sizes on `skeleton.base`, with the
 * P:08 shimmer — a 90° `base 25% → highlight 50% → base 75%` band sliding across in 1.6 s linear.
 * "Başlık ve tarih anında; yalnızca AI içeriği iskelet." Under reduce motion the block is a static
 * `skeleton.base`. Blocks are hidden from assistive technology; `SkeletonGroup` is the busy
 * container announced as "Yükleniyor".
 */
import { useState, type JSX, type ReactNode } from 'react';
import {
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { hiddenFromA11y } from '../theme/a11y.ts';
import { useMotion, useUiStrings } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { GradientFill } from './GradientFill.tsx';
import { useLoop } from './useLoop.ts';

export interface SkeletonBlockProps {
  readonly width?: DimensionValue;
  readonly height: number;
  /** Default: height / 2 (22-px title bars use 8). */
  readonly radius?: number;
  /** `bg`: the flat page-background block used for secondary button stand-ins (no shimmer). */
  readonly tone?: 'base' | 'bg';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function SkeletonBlock({
  width = '100%',
  height,
  radius,
  tone = 'base',
  style,
  testID,
}: SkeletonBlockProps): JSX.Element {
  const theme = useTheme();
  const { loops } = useMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const progress = useLoop({ durationMs: theme.motion.loop.shimmer, rest: 0 });
  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.get() * 2 - 1) * boxWidth }],
  }));
  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next !== boxWidth) setBoxWidth(next);
  };
  const r = radius ?? (height === 22 ? 8 : height / 2);
  return (
    <View
      testID={testID}
      onLayout={onLayout}
      {...hiddenFromA11y}
      style={[
        {
          width,
          height,
          borderRadius: r,
          overflow: 'hidden',
          backgroundColor: tone === 'bg' ? theme.color.bg : theme.color.skeleton.base,
        },
        style,
      ]}
    >
      {loops && tone === 'base' ? (
        <Animated.View
          testID={testID === undefined ? undefined : `${testID}.shimmer`}
          style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, band]}
        >
          <GradientFill gradient={theme.gradients.skeletonShimmer} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export interface SkeletonGroupProps {
  /** Screen-reader label; defaults to "Yükleniyor" (`common.a11y.loading`). */
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly children: ReactNode;
}

/** The busy container of skeleton blocks (`accessibilityState.busy`, label "Yükleniyor"). */
export function SkeletonGroup({
  accessibilityLabel,
  style,
  testID,
  children,
}: SkeletonGroupProps): JSX.Element {
  const strings = useUiStrings();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? strings.a11y.loading}
      accessibilityState={{ busy: true }}
      style={style}
    >
      {children}
    </View>
  );
}
