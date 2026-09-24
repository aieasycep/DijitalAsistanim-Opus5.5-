/**
 * Motion (DESIGN_AUDIT §2.13) and haptics (§2.14). Verbatim rules from P:08:
 * "Hiçbir animasyon 600 ms'yi geçmez; kullanıcı beklerken animasyon değil bulgu gösterilir."
 * "'Hareketi azalt' açıkken tüm süreler 0, yalnızca opaklık geçişi 120 ms kalır."
 * Loops (shimmer, spinner, pulse) are continuous indicators, not transitions, and stop under
 * reduce motion.
 */

/** Cubic-bézier control points `[x1, y1, x2, y2]`. */
export type Bezier = readonly [number, number, number, number];

export const easing = {
  /** Standard curve: `cubic-bezier(.2,.8,.2,1)` (Reanimated `Easing.bezier(0.2, 0.8, 0.2, 1)`). */
  standard: [0.2, 0.8, 0.2, 1],
  /** Exit curve (`ease-out`). */
  exit: [0, 0, 0.58, 1],
  /** Spinners and shimmer. */
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

/** Transition durations in ms; none exceeds {@link MAX_DURATION}. */
export const duration = {
  press: 120,
  iconSwap: 120,
  reducedOpacity: 120,
  chip: 150,
  tab: 150,
  iconFill: 160,
  badge: 160,
  button: 200,
  chevron: 200,
  hero: 240,
  sheetClose: 240,
  dim: 250,
  swipeRelease: 260,
  cardEnter: 280,
  expand: 280,
  sheetOpen: 300,
  toastIn: 300,
  toastOut: 300,
  cardExit: 300,
  listReflow: 300,
  cardToHistory: 320,
  countUp: 360,
  syncLine: 400,
  successIcon: 450,
  successRing: 500,
} as const;

export const MAX_DURATION = 600;

export const delay = {
  stagger: 60,
  cardsStart: 360,
  successIcon: 100,
  countStart: 240,
} as const;

/** Continuous indicators (ms per cycle). */
export const loop = {
  shimmer: 1600,
  spinner: 800,
  pulse: 1600,
  typing: 800,
  typingStagger: 150,
  barsMin: 700,
  barsMax: 1200,
  barsStagger: 60,
} as const;

/** How long transient UI stays visible (ms). */
export const hold = {
  toast: 2600,
  undoToast: 5000,
  undoToastScreenReader: 10000,
  syncMessage: 1500,
  voiceSilence: 1200,
} as const;

export const motionDistance = { heroY: 8, toastY: 16, completeY: -6 } as const;

export const motionScale = {
  buttonPressed: 0.97,
  cardPressed: 0.98,
  cardComplete: 0.96,
  successIconFrom: 0.4,
  pulseFrom: 0.9,
  pulseTo: 1.35,
} as const;

/** Swipe release spring and threshold. */
export const swipe = { threshold: 0.35, damping: 20, stiffness: 220 } as const;

export const motion = {
  easing,
  duration,
  delay,
  loop,
  hold,
  distance: motionDistance,
  scale: motionScale,
  swipe,
  max: MAX_DURATION,
} as const;

/** Haptic kind per product event (§2.14). "asla dekor için". */
export const haptics = {
  complete: 'success',
  approveExecuted: 'success',
  sendConfirmed: 'success',
  reminderCreated: 'success',
  commitmentSaved: 'success',
  select: 'light',
  swipeThreshold: 'light',
  playPause: 'light',
  sheetOpen: 'light',
  pullToSync: 'light',
  conflict: 'warning',
  errorOnAction: 'warning',
  validationError: 'warning',
} as const satisfies Record<string, 'success' | 'light' | 'warning'>;

export type HapticEvent = keyof typeof haptics;

/** CSS `cubic-bezier(…)` string. */
export function bezierToCss(curve: Bezier): string {
  return `cubic-bezier(${curve.join(', ')})`;
}
