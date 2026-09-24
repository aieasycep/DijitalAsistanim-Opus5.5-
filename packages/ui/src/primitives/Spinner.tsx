/**
 * `Spinner` (DESIGN_AUDIT §3.9, P:08 `daspin`): a 2 px ring — track `control.spinnerTrack` (or the
 * colour at 40% on fills), top arc in the colour — rotating .8 s linear. Sizes 14 (kicker),
 * 16 (buttons), 22 (rows). Hidden from assistive technology: the parent carries `busy` and the
 * kicker text. Under reduce motion the ring is static.
 */
import type { JSX } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { hiddenFromA11y } from '../theme/a11y.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { useLoop } from './useLoop.ts';

export type SpinnerTone =
  'primary' | 'onPrimary' | 'ink' | 'onSoft' | 'onGradient' | 'onDestructive';

export interface SpinnerProps {
  readonly size?: 14 | 16 | 22;
  readonly tone?: SpinnerTone;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

function spinnerColors(
  tone: SpinnerTone,
  theme: ReturnType<typeof useTheme>,
): { arc: ColorValue; track: ColorValue } {
  const c = theme.color;
  switch (tone) {
    case 'onPrimary':
      return { arc: c.text.onPrimary, track: c.onGradient.fill25 };
    case 'onDestructive':
      return { arc: c.button.destructive.text, track: c.onGradient.fill25 };
    case 'onGradient':
      return { arc: c.text.onGradient, track: c.onGradient.fill25 };
    case 'ink':
      return { arc: c.text.primary, track: c.border.control };
    case 'onSoft':
      return { arc: c.brand.onSoft, track: c.control.spinnerTrack };
    case 'primary':
      return { arc: c.brand.primary, track: c.control.spinnerTrack };
  }
}

export function Spinner({ size = 16, tone = 'primary', style, testID }: SpinnerProps): JSX.Element {
  const theme = useTheme();
  const progress = useLoop({ durationMs: theme.motion.loop.spinner, rest: 0 });
  const { arc, track } = spinnerColors(tone, theme);
  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(progress.get() * 360)}deg` }],
  }));
  return (
    <Animated.View
      testID={testID}
      {...hiddenFromA11y}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: track,
          borderTopColor: arc,
        },
        animated,
        style,
      ]}
    />
  );
}
