/**
 * Elevation (DESIGN_AUDIT §2.10). Light uses warm drop shadows; dark uses hairline rings
 * (`0 0 0 1px rgba(255,255,255,.06)`) instead of shadows, except the primary CTA glow, the
 * composer and the indigo prep card. React Native (New Architecture) takes the same strings
 * through the `boxShadow` style; Android API < 28 falls back to {@link androidElevation}.
 */
import { color, type ColorSchemeName } from './color.ts';
import { alpha, palette } from './palette.ts';

export interface ShadowLayer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}

/** Layers from bottom to top as written in CSS; an empty list means no shadow. */
export type ShadowToken = readonly ShadowLayer[];

function drop(x: number, y: number, blur: number, c: string): ShadowLayer {
  return { x, y, blur, spread: 0, color: c };
}

function ring(width: number, c: string): ShadowLayer {
  return { x: 0, y: 0, blur: 0, spread: width, color: c };
}

const ink = palette.warm.shadowInk;
const white = palette.warm.white;
const black = palette.warm.black;
const indigo = palette.indigo.primary;

export const SHADOW_NAMES = [
  's1',
  's1Control',
  's1Soft',
  'card',
  'page',
  'heroAi',
  'ctaPrimary',
  'ctaInk',
  'composer',
  'segmentThumb',
  'knob',
  'toast',
  'modal',
  'sheet',
  'inkCard',
  'swipeLeft',
  'swipeRight',
  'play',
  'float',
  'focusRing',
  'errorRing',
  'selectedRing',
] as const;

export type ShadowName = (typeof SHADOW_NAMES)[number];

const light: Record<ShadowName, ShadowToken> = {
  s1: [drop(0, 1, 2, alpha(ink, 0.06))],
  s1Control: [drop(0, 1, 2, alpha(ink, 0.08))],
  s1Soft: [drop(0, 1, 2, alpha(ink, 0.04))],
  card: [drop(0, 1, 2, alpha(ink, 0.04)), drop(0, 6, 20, alpha(ink, 0.05))],
  page: [drop(0, 12, 32, alpha(ink, 0.14))],
  heroAi: [drop(0, 1, 2, alpha(ink, 0.04)), drop(0, 12, 32, alpha(indigo, 0.1))],
  ctaPrimary: [drop(0, 8, 24, alpha(indigo, 0.28))],
  ctaInk: [drop(0, 8, 24, alpha(ink, 0.18))],
  composer: [drop(0, 1, 2, alpha(ink, 0.06)), drop(0, 8, 24, alpha(ink, 0.08))],
  segmentThumb: [drop(0, 1, 3, alpha(ink, 0.12))],
  knob: [drop(0, 1, 3, alpha(ink, 0.2))],
  toast: [drop(0, 10, 30, alpha(ink, 0.25))],
  modal: [drop(0, 20, 50, alpha(ink, 0.25))],
  sheet: [drop(0, -10, 40, alpha(ink, 0.12))],
  inkCard: [drop(0, 12, 32, alpha(ink, 0.18))],
  swipeLeft: [drop(-8, 0, 24, alpha(ink, 0.1))],
  swipeRight: [drop(8, 0, 24, alpha(ink, 0.1))],
  play: [drop(0, 10, 30, alpha(black, 0.25))],
  float: [drop(0, 20, 50, alpha(ink, 0.14))],
  focusRing: [ring(2, color.light.border.focus)],
  errorRing: [ring(2, color.light.border.error)],
  selectedRing: [ring(2, color.light.border.selected)],
};

const dark: Record<ShadowName, ShadowToken> = {
  s1: [],
  s1Control: [ring(1, alpha(white, 0.08))],
  s1Soft: [ring(1, alpha(white, 0.06))],
  card: [ring(1, alpha(white, 0.06))],
  page: [ring(1, alpha(white, 0.08))],
  heroAi: [ring(1, alpha(white, 0.06))],
  ctaPrimary: [drop(0, 8, 24, alpha(indigo, 0.25))],
  // The ink CTA renders as the dark primary CTA (DESIGN_AUDIT §2.16 rule 3).
  ctaInk: [drop(0, 8, 24, alpha(indigo, 0.25))],
  composer: [ring(1, alpha(white, 0.08)), drop(0, 8, 24, alpha(black, 0.35))],
  segmentThumb: [],
  knob: [drop(0, 1, 3, alpha(ink, 0.2))],
  toast: [ring(1, alpha(white, 0.08))],
  modal: [ring(1, alpha(white, 0.08))],
  sheet: [],
  inkCard: [drop(0, 12, 32, alpha(indigo, 0.25))],
  swipeLeft: [ring(1, alpha(white, 0.06))],
  swipeRight: [ring(1, alpha(white, 0.06))],
  play: [drop(0, 10, 30, alpha(black, 0.25))],
  float: [ring(1, alpha(white, 0.08))],
  focusRing: [ring(2, color.dark.border.focus)],
  errorRing: [ring(2, color.dark.border.error)],
  selectedRing: [ring(2, color.dark.border.selected)],
};

export const shadow: { readonly light: typeof light; readonly dark: typeof dark } = {
  light,
  dark,
};

/**
 * Android API < 28 cannot draw outset `boxShadow`; these `elevation` values replace the light
 * shadows there (card 2, page 6, sheet 12 per the audit; the others are scaled to match).
 */
export const androidElevation: Record<ShadowName, number> = {
  s1: 1,
  s1Control: 1,
  s1Soft: 1,
  card: 2,
  page: 6,
  heroAi: 3,
  ctaPrimary: 4,
  ctaInk: 4,
  composer: 3,
  segmentThumb: 1,
  knob: 1,
  toast: 6,
  modal: 12,
  sheet: 12,
  inkCard: 6,
  swipeLeft: 4,
  swipeRight: 4,
  play: 6,
  float: 8,
  focusRing: 0,
  errorRing: 0,
  selectedRing: 0,
};

function px(n: number): string {
  return n === 0 ? '0' : `${String(n)}px`;
}

/** CSS `box-shadow` / React Native `boxShadow` string; `none` for an empty token. */
export function shadowToCss(token: ShadowToken): string {
  if (token.length === 0) return 'none';
  return token
    .map((l) => {
      const spread = l.spread === 0 ? '' : ` ${px(l.spread)}`;
      return `${px(l.x)} ${px(l.y)} ${px(l.blur)}${spread} ${l.color}`;
    })
    .join(', ');
}

/** Convenience accessor: the `boxShadow` string for a token in a scheme. */
export function boxShadow(scheme: ColorSchemeName, name: ShadowName): string {
  return shadowToCss(shadow[scheme][name]);
}
