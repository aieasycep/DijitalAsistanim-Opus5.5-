/**
 * Screen transitions and motion timings from `@da/design-tokens` (DESIGN_AUDIT §2.13, T-8.29):
 * with "Hareketi azalt" (the OS setting OR `user_preferences.reduce_motion`) every push becomes
 * the one remaining opacity transition (`duration.reducedOpacity`, 120 ms) instead of a slide;
 * otherwise the platform's native transition runs.
 */
import { duration } from '@da/design-tokens';
import { useUiPreferences } from '@da/ui';

export interface StackMotion {
  readonly animation?: 'fade';
  readonly animationDuration?: number;
}

export const REDUCED_STACK_MOTION: StackMotion = {
  animation: 'fade',
  animationDuration: duration.reducedOpacity,
};

/** Stack `screenOptions` for the current motion preference. */
export function useStackMotion(): StackMotion {
  const { reduceMotion } = useUiPreferences();
  return reduceMotion ? REDUCED_STACK_MOTION : {};
}
