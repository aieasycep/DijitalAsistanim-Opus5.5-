/**
 * Selection colour transition (DESIGN_AUDIT §2.13: "Chip / segment / tab colour — background and
 * colour transition, 150 ms"). Returns an animated `backgroundColor` interpolated between the
 * unselected and selected fills; under reduce motion it switches instantly.
 */
import { useEffect } from 'react';
import { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { AnimatedViewStyle } from './PressableScale.tsx';
import { useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';

export function useSelectionBackground(
  selected: boolean,
  off: string,
  on: string,
): AnimatedViewStyle {
  const theme = useTheme();
  const motionControl = useMotion();
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    progress.set(motionControl.animate(selected ? 1 : 0, theme.motion.duration.chip));
  }, [selected, motionControl, progress, theme.motion.duration.chip]);
  return useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [off, on]),
  }));
}
