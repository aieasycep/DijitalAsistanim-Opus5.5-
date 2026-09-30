/**
 * Card exit (DESIGN_AUDIT §2.13 "Öncelik tamamlandı": card scale .96 + fade + translateY −6 over
 * 300 ms, then the list reflows). While `exiting` is true the style animates out and `onExited`
 * runs once the duration has elapsed. Under reduce motion only a 120 ms fade remains.
 */
import { useEffect, useRef } from 'react';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import type { AnimatedViewStyle } from './PressableScale.tsx';

export function useExitAnimation(
  exiting: boolean,
  onExited: (() => void) | undefined,
  durationMs?: number,
): AnimatedViewStyle {
  const theme = useTheme();
  const motionControl = useMotion();
  const progress = useSharedValue(0);
  const done = useRef(onExited);
  useEffect(() => {
    done.current = onExited;
  }, [onExited]);
  const duration = durationMs ?? theme.motion.duration.cardExit;
  useEffect(() => {
    if (!exiting) {
      progress.set(0);
      return undefined;
    }
    progress.set(motionControl.fade(1, duration));
    const timer = setTimeout(() => {
      done.current?.();
    }, motionControl.fadeDuration(duration));
    return () => {
      clearTimeout(timer);
    };
  }, [exiting, duration, motionControl, progress]);
  const scaleTo = theme.motion.scale.cardComplete;
  const lift = theme.motion.distance.completeY;
  const reduce = motionControl.reduceMotion;
  return useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: 1 - p,
      transform: reduce ? [] : [{ scale: 1 - (1 - scaleTo) * p }, { translateY: lift * p }],
    };
  });
}
