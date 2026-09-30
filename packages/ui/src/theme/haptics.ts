/**
 * Haptics contract (DESIGN_AUDIT §2.14). The kit never imports a native module: the app injects
 * the implementation (expo-haptics) through `UiPreferencesProvider.onHaptic`, and every call is
 * gated by `user_preferences.haptics_enabled` ("Haptik geri bildirim", default on). Rule
 * (verbatim): "asla dekor için" — only the product events in `@da/design-tokens` `haptics`.
 *
 * Mapping for the app's implementation:
 * - `success` → `Haptics.notificationAsync(NotificationFeedbackType.Success)`
 * - `warning` → `Haptics.notificationAsync(NotificationFeedbackType.Warning)`
 * - `light`   → `Haptics.impactAsync(ImpactFeedbackStyle.Light)`
 * - `selection` → `Haptics.selectionAsync()` (chip, segment and tab selection)
 */
import { haptics, type HapticEvent } from '@da/design-tokens';

export const HAPTIC_KINDS = ['success', 'warning', 'light', 'selection'] as const;
export type HapticKind = (typeof HAPTIC_KINDS)[number];

/** The app-provided implementation. It must not throw; failures are swallowed by the kit. */
export type HapticsHandler = (kind: HapticKind) => void;

/** The haptic kind of a product event (`complete` → `success`, `select` → `selection`). */
export function hapticKindFor(event: HapticEvent): HapticKind {
  if (event === 'select') return 'selection';
  return haptics[event];
}

export type { HapticEvent };
