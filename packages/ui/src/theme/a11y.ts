/**
 * Accessibility helpers (ADR-03, DESIGN_AUDIT §3.0, DEV-22): minimum hit targets of 44 × 44 pt on
 * iOS and 48 × 48 dp on Android reached through `hitSlop` (visual sizes stay as designed),
 * announcements for toasts and banners, and moving the screen-reader focus to a sheet title.
 */
import { size } from '@da/design-tokens';
import type { RefObject } from 'react';
import { AccessibilityInfo, Platform, type Insets } from 'react-native';

/** 44 pt on iOS, 48 dp on Android. */
export function minTouchTarget(): number {
  return Platform.OS === 'android' ? size.hitMin.android : size.hitMin.ios;
}

/**
 * `hitSlop` that grows a control of the given visual size to the platform minimum; undefined when
 * it is already large enough.
 */
export function hitSlopFor(width: number, height: number): Insets | undefined {
  const min = minTouchTarget();
  const x = Math.max(0, Math.ceil((min - width) / 2));
  const y = Math.max(0, Math.ceil((min - height) / 2));
  if (x === 0 && y === 0) return undefined;
  return { top: y, bottom: y, left: x, right: x };
}

/** Announces a message to VoiceOver / TalkBack (toasts, banners, status changes). */
export function announce(message: string): void {
  if (message === '') return;
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Moves the screen-reader focus to a host element (sheet and dialog titles on open, the
 * invoking control on close).
 */
export function focusAccessibility(ref: RefObject<unknown>): void {
  const node = ref.current;
  if (node === null || node === undefined) return;
  AccessibilityInfo.sendAccessibilityEvent(
    node as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0],
    'focus',
  );
}

/** Props that hide a decorative subtree from assistive technology on both platforms. */
export const hiddenFromA11y = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;
