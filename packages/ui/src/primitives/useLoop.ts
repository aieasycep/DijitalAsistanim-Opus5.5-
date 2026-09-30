/**
 * Continuous indicator loops (spinner .8 s, shimmer 1.6 s, pulse 1.6 s, bars .7–1.2 s): a shared
 * progress value 0 → 1 repeated with the linear curve, or alternating for bars. Loops never run
 * under reduce motion (they stop at `rest`, a mid frame by default), and they are cancelled on
 * unmount.
 */
import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useMotion } from '../theme/preferences.tsx';

export interface LoopOptions {
  readonly durationMs: number;
  /** Run only while true (e.g. bars only while audio plays). Default true. */
  readonly active?: boolean;
  /** Ping-pong 0 → 1 → 0 (bars, typing dots). Default false (restart at 0). */
  readonly alternate?: boolean;
  readonly delayMs?: number;
  /** Value held while the loop is not running (reduce motion, inactive). Default 0.5. */
  readonly rest?: number;
}

export function useLoop({
  durationMs,
  active = true,
  alternate = false,
  delayMs = 0,
  rest = 0.5,
}: LoopOptions): SharedValue<number> {
  const { loops } = useMotion();
  const progress = useSharedValue(rest);
  const running = loops && active;
  useEffect(() => {
    if (!running) {
      cancelAnimation(progress);
      progress.set(rest);
      return undefined;
    }
    progress.set(0);
    const cycle = withRepeat(
      withTiming(1, {
        duration: durationMs,
        easing: alternate ? Easing.inOut(Easing.ease) : Easing.linear,
      }),
      -1,
      alternate,
    );
    progress.set(delayMs > 0 ? withDelay(delayMs, cycle) : cycle);
    return () => {
      cancelAnimation(progress);
    };
  }, [running, durationMs, alternate, delayMs, rest, progress]);
  return progress;
}
