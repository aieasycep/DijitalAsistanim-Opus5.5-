/**
 * Gradients (DESIGN_AUDIT §2.6). Dawn, night and dusk are identical in both schemes
 * ("Şafak gradyanı her iki modda aynı"). Scheme-dependent gradients are built from the
 * semantic colours by {@link themedGradients}.
 */
import { color, type ColorSchemeName } from './color.ts';
import { mixColors, parseColor, toHex, type Rgba } from './contrast.ts';
import { alpha, palette } from './palette.ts';

export interface GradientStop {
  readonly color: string;
  /** Position along the gradient line, 0–1. */
  readonly at: number;
}

export interface LinearGradientToken {
  readonly kind: 'linear';
  /** CSS angle in degrees (0 = to top, 90 = to right, 180 = to bottom). */
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradientToken {
  readonly kind: 'radial';
  /** Ellipse radii as a fraction of the box (`radial-gradient(140% 100% …)`). */
  readonly radius: { readonly x: number; readonly y: number };
  /** Centre as a fraction of the box. */
  readonly center: { readonly x: number; readonly y: number };
  readonly stops: readonly GradientStop[];
}

export type GradientToken = LinearGradientToken | RadialGradientToken;

function linear(angle: number, stops: readonly (readonly [string, number])[]): LinearGradientToken {
  return { kind: 'linear', angle, stops: stops.map(([c, at]) => ({ color: c, at })) };
}

const i = palette.indigo;

export const gradient = {
  /** Morning brief header, onboarding brand moment, share card, referral hero. */
  dawn: linear(160, [
    [i.dawnStart, 0],
    [i.dawnMid, 0.58],
    [i.dawnEnd, 1],
  ]),
  /** Full-screen dawn backgrounds with bottom-anchored small text (DEV-12). */
  dawnFullbleed: linear(160, [
    [i.dawnStart, 0],
    [i.dawnMid, 0.58],
    [i.dawnFullbleedEnd, 1],
  ]),
  /** Voice mode, audio player, analysis in progress (70% variant normalised to 60%, D-37). */
  night: linear(180, [
    [i.nightStart, 0],
    [i.nightMid, 0.6],
    [i.dawnMid, 1],
  ]),
  /** Evening close header. */
  dusk: linear(160, [
    [palette.dusk.start, 0],
    [palette.dusk.mid, 0.55],
    [palette.dusk.end, 1],
  ]),
  /** Dark-mode "3 şey" / meeting-prep talking-points card. */
  prepCardDark: linear(160, [
    [i.prepStart, 0],
    [i.prepEnd, 1],
  ]),
  /** Lock-screen widget preview only. */
  lockscreenDawn: linear(180, [
    [i.dawnStart, 0],
    [i.dawnMid, 0.7],
    [i.dawnEnd, 1],
  ]),
} as const satisfies Record<string, LinearGradientToken>;

export type GradientName = keyof typeof gradient;

export interface ThemedGradients {
  /** AI insight card glow from the top-left corner. */
  readonly aiGlowTopLeft: RadialGradientToken;
  /** Today hero glow from the top-right corner. */
  readonly aiGlowTopRight: RadialGradientToken;
  /** Sticky footer fade from transparent to the page background. */
  readonly fadeToBg: LinearGradientToken;
  /** Paywall / onboarding top tint. */
  readonly onboardingTint: LinearGradientToken;
  /** Skeleton shimmer band (animated with translateX; static base under reduce motion). */
  readonly skeletonShimmer: LinearGradientToken;
}

function radialGlow(scheme: ColorSchemeName, x: number, stop: number): RadialGradientToken {
  const glow = color[scheme].aiGlow;
  return {
    kind: 'radial',
    radius: { x: 1.4, y: 1 },
    center: { x, y: 0 },
    stops: [
      { color: glow.from, at: 0 },
      { color: glow.to, at: stop },
    ],
  };
}

/** Gradients whose colours depend on the scheme. */
export function themedGradients(scheme: ColorSchemeName): ThemedGradients {
  const c = color[scheme];
  const transparentBg = alpha(toHex(parseColor(c.bg)), 0);
  const tintTop = scheme === 'light' ? c.brand.soft : alpha(palette.indigo.primaryDark, 0.12);
  return {
    aiGlowTopLeft: radialGlow(scheme, 0, 0.6),
    aiGlowTopRight: radialGlow(scheme, 1, 0.58),
    fadeToBg: linear(180, [
      [transparentBg, 0],
      [c.bg, 0.45],
    ]),
    onboardingTint: linear(180, [
      [tintTop, 0],
      [c.bg, 0.32],
    ]),
    skeletonShimmer: linear(90, [
      [c.skeleton.base, 0.25],
      [c.skeleton.highlight, 0.5],
      [c.skeleton.base, 0.75],
    ]),
  };
}

function pct(at: number): string {
  return `${String(Math.round(at * 10000) / 100)}%`;
}

/** CSS `linear-gradient(…)` / `radial-gradient(…)` string for web. */
export function gradientToCss(token: GradientToken): string {
  const stops = token.stops.map((s) => `${s.color} ${pct(s.at)}`).join(',');
  if (token.kind === 'linear') return `linear-gradient(${String(token.angle)}deg,${stops})`;
  const { radius, center } = token;
  return `radial-gradient(${pct(radius.x)} ${pct(radius.y)} at ${pct(center.x)} ${pct(center.y)},${stops})`;
}

export interface GradientPoints {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000 + 0;

/**
 * Converts a CSS gradient angle to `expo-linear-gradient` `start`/`end` points (fractions of
 * the box), reproducing the CSS gradient line for a box of the given aspect ratio.
 */
export function cssAngleToPoints(angle: number, width = 1, height = 1): GradientPoints {
  const rad = (angle * Math.PI) / 180;
  // Direction of the gradient line in screen coordinates (y grows downwards).
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (width * Math.abs(dx) + height * Math.abs(dy)) / 2;
  const start = { x: (width / 2 - dx * half) / width, y: (height / 2 - dy * half) / height };
  const end = { x: (width / 2 + dx * half) / width, y: (height / 2 + dy * half) / height };
  return {
    start: { x: round4(start.x), y: round4(start.y) },
    end: { x: round4(end.x), y: round4(end.y) },
  };
}

/** Opaque colour of a linear gradient at position `t` (0–1) along its line. */
export function sampleGradient(token: LinearGradientToken, t: number): Rgba {
  const stops = token.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error('Gradient without stops');
  if (t <= first.at) return parseColor(first.color);
  if (t >= last.at) return parseColor(last.color);
  for (let k = 1; k < stops.length; k += 1) {
    const lo = stops[k - 1];
    const hi = stops[k];
    if (lo && hi && t <= hi.at) {
      return mixColors(parseColor(lo.color), parseColor(hi.color), (t - lo.at) / (hi.at - lo.at));
    }
  }
  return parseColor(last.color);
}
