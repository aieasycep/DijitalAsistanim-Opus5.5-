/**
 * The explicit contrast pair list (DESIGN_AUDIT §2.15, §8.4). Every placement of a foreground
 * token on a background that the product uses is listed here, once, independent of the scheme:
 * `test/contrast.test.ts` checks each pair in light AND dark, so a component written against
 * these semantic tokens is accessible in both. Thresholds (WCAG 2.2): informational text 4.5:1,
 * large text (≥ 24 px, or ≥ 18.66 px bold) 3:1, UI components and meaningful icons (1.4.11) 3:1.
 *
 * `expected` holds the ratios published in DESIGN_AUDIT §2.15 (regression fixtures, ±0.01).
 */
import { colorAt, type ColorPath, type ColorSchemeName } from './color.ts';
import { composite, contrastRatio, parseColor, type Rgba } from './contrast.ts';
import { gradient, sampleGradient, type GradientName } from './gradient.ts';

export type ContrastKind = 'text' | 'large' | 'nontext';

export const MIN_CONTRAST: Record<ContrastKind, number> = { text: 4.5, large: 3, nontext: 3 };

/** A flat token composited over `over` (default `bg`), or a gradient sampled at `at` (0–1). */
export type ContrastBackground =
  | { readonly color: ColorPath; readonly over?: ColorPath }
  | { readonly gradient: GradientName; readonly at: number };

export interface ContrastPair {
  readonly id: string;
  readonly fg: ColorPath;
  readonly bg: ContrastBackground;
  readonly kind: ContrastKind;
  readonly expected?: Partial<Record<ColorSchemeName, number>>;
}

type Fixture = Partial<Record<ColorSchemeName, number>>;

/** Page-level opaque surfaces. */
const PAGE = ['bg', 'surface', 'bgEditorial', 'surfacePressed'] as const;
/** Plan timeline blocks (drawn on the page background). */
const PLAN = ['plan.ai', 'plan.life'] as const;
/** Tone soft backgrounds (badges, pills, tiles, info boxes) — drawn on cards. */
const SOFTS = [
  'tone.critical.soft',
  'tone.warning.soft',
  'tone.success.soft',
  'tone.info.soft',
  'tone.neutral.soft',
  'tone.primary.soft',
] as const;

const OVER_SURFACE = new Set<ColorPath>([
  ...SOFTS,
  'surfaceSunken',
  'surfaceTrack',
  'aiGlow.from',
  'brand.soft',
]);

function on(color: ColorPath): ContrastBackground {
  return { color, over: OVER_SURFACE.has(color) ? 'surface' : 'bg' };
}

const pairs: ContrastPair[] = [];

function add(
  fg: ColorPath,
  backgrounds: readonly ColorPath[],
  kind: ContrastKind,
  fixtures: Partial<Record<ColorPath, Fixture>> = {},
): void {
  for (const bg of backgrounds) {
    const expected = fixtures[bg];
    pairs.push({
      id: `${fg} on ${bg}`,
      fg,
      bg: on(bg),
      kind,
      ...(expected ? { expected } : {}),
    });
  }
}

function addGradient(
  fg: ColorPath,
  gradientName: GradientName,
  at: number,
  kind: ContrastKind,
  expected?: Fixture,
): void {
  pairs.push({
    id: `${fg} on gradient ${gradientName}@${String(at)}`,
    fg,
    bg: { gradient: gradientName, at },
    kind,
    ...(expected ? { expected } : {}),
  });
}

// ── Informational text ─────────────────────────────────────────────────────────────────────
add(
  'text.primary',
  [
    ...PAGE,
    ...PLAN,
    'surfaceSunken',
    ...SOFTS,
    'aiGlow.from',
    'surfaceTrack',
    'overlay.tabBar',
    'overlay.glassCard',
  ],
  'text',
  {
    bg: { light: 15.96, dark: 16.3 },
    surface: { light: 17.57, dark: 14.64 },
    bgEditorial: { light: 16.83 },
  },
);
add('text.secondary', [...PAGE, ...PLAN, 'surfaceSunken', ...SOFTS], 'text', {
  surface: { light: 5.56, dark: 6.32 },
  bg: { light: 5.06, dark: 7.04 },
  surfaceSunken: { light: 4.84, dark: 5.0 },
});
add('text.secondaryOnTrack', ['surfaceTrack'], 'text');
add('text.tertiaryStrong', [...PAGE, ...PLAN, 'overlay.tabBar'], 'text', {
  surface: { light: 5.23 },
  bg: { light: 4.76 },
  bgEditorial: { light: 5.01 },
  'overlay.tabBar': { light: 5.19 },
});
add('tabBar.inactive', ['overlay.tabBar', 'overlay.tabBarOpaque'], 'text');
add('text.onAiGlow', ['aiGlow.from', 'surface'], 'text', {
  'aiGlow.from': { light: 4.86, dark: 5.02 },
});
add('text.link', [...PAGE, 'surfaceSunken', 'aiGlow.from'], 'text');
// The hero count "N" is the only coloured count (DESIGN_AUDIT §2.5 rule 6).
add('text.accent', PAGE, 'text');
add(
  'brand.onSoft',
  [...PAGE, 'tone.primary.soft', 'brand.soft', 'plan.ai', 'aiGlow.from'],
  'text',
  {
    'tone.primary.soft': { light: 6.04 },
    surface: { light: 7.01 },
    'plan.ai': { light: 6.57 },
    'aiGlow.from': { light: 5.6 },
  },
);
// Tone map text (Badge, StatusPill, ToneText): on its own soft and on page surfaces.
add('tone.critical.textStrong', ['tone.critical.soft', ...PAGE], 'text', {
  'tone.critical.soft': { light: 4.68, dark: 5.57 },
  bg: { light: 4.85 },
});
add('tone.warning.text', ['tone.warning.soft', ...PAGE], 'text', {
  'tone.warning.soft': { light: 4.55, dark: 6.94 },
  bg: { light: 4.59 },
  surface: { light: 5.05 },
});
add('tone.success.text', ['tone.success.soft', ...PAGE], 'text', {
  'tone.success.soft': { light: 4.72 },
});
add('tone.info.text', ['tone.info.soft', ...PAGE], 'text', {
  'tone.info.soft': { light: 5.14 },
});
add('tone.neutral.text', ['tone.neutral.soft', ...PAGE], 'text', {
  'tone.neutral.soft': { light: 4.84, dark: 5.0 },
});
add('tone.primary.text', ['tone.primary.soft', ...PAGE], 'text');
add('tone.success.deep', ['tone.success.soft'], 'text', {
  'tone.success.soft': { light: 7.21 },
});
// Text on filled controls and inverted surfaces.
add('text.onPrimary', ['brand.primary', 'brand.primaryPressed'], 'text', {
  'brand.primary': { light: 5.15, dark: 5.96 },
});
add('button.destructive.text', ['button.destructive.bg', 'button.destructive.pressed'], 'text', {
  'button.destructive.bg': { light: 4.92 },
});
add('inverse.text', ['inverse.bg'], 'text');
add('text.onInk', ['surfaceInk'], 'text');
add('swipe.completeText', ['swipe.completeBg'], 'text', {
  'swipe.completeBg': { light: 5.34 },
});
add('toast.text', ['toast.bg'], 'text', { 'toast.bg': { light: 17.57, dark: 12.77 } });
add('toast.action', ['toast.bg'], 'text', { 'toast.bg': { light: 8.16 } });
add('avatar.peach.fg', ['avatar.peach.bg'], 'text', {
  'avatar.peach.bg': { light: 6.55, dark: 6.55 },
});
add('avatar.blue.fg', ['avatar.blue.bg'], 'text', {
  'avatar.blue.bg': { light: 7.98, dark: 7.98 },
});
add('avatar.green.fg', ['avatar.green.bg'], 'text', {
  'avatar.green.bg': { light: 6.91, dark: 6.91 },
});
add('avatar.neutral.fg', ['avatar.neutral.bg'], 'text', {
  'avatar.neutral.bg': { light: 4.84, dark: 4.84 },
});
add('avatar.self.fg', ['avatar.self.bg'], 'text');

// Text on gradients (DESIGN_AUDIT §2.6 text-safe rules; sampled at the deepest allowed point).
addGradient('text.onGradientSecondary', 'dawn', 0.8, 'text', { light: 4.72, dark: 4.72 });
addGradient('text.onGradientTertiary', 'dawn', 0.6, 'text');
addGradient('text.onGradient', 'dawn', 1, 'large');
addGradient('text.onGradient', 'dawnFullbleed', 1, 'text');
addGradient('text.onGradientSecondary', 'dusk', 0.8, 'text', { light: 4.75, dark: 4.75 });
addGradient('text.onGradientTertiary', 'dusk', 0.6, 'text');
addGradient('text.onGradient', 'night', 1, 'text');
addGradient('text.onGradientSecondary', 'night', 1, 'text');
addGradient('text.onGradientTertiary', 'night', 0.9, 'text');
addGradient('text.countOnDawn', 'dawn', 0.6, 'large');
addGradient('text.kickerOnIndigo', 'prepCardDark', 0, 'text');
addGradient('text.kickerOnIndigo', 'prepCardDark', 1, 'text');

// ── UI components and meaningful icons (WCAG 1.4.11) ───────────────────────────────────────
add('icon.default', [...PAGE, 'surfaceSunken'], 'nontext');
add('icon.idle', ['surface', 'bg'], 'nontext', { surface: { light: 3.39, dark: 4.34 } });
add('icon.ai', [...PAGE, 'aiGlow.from', 'tone.primary.soft'], 'nontext', {
  'aiGlow.from': { light: 4.12, dark: 4.99 },
  surface: { dark: 7.74 },
});
add('tabBar.active', ['overlay.tabBar', 'overlay.tabBarOpaque'], 'nontext');
add('brand.primary', ['surface', 'bg'], 'nontext', { surface: { light: 5.15 } });
add('control.switchOn', ['surface', 'bg'], 'nontext');
add('control.radioOff', ['surface', 'bg'], 'nontext', { surface: { light: 3.39 } });
add('control.switchOffBorder', ['surface', 'bg'], 'nontext', {
  surface: { light: 3.39, dark: 4.34 },
});
add('border.focus', ['surface', 'bg'], 'nontext');
add('border.selected', ['surface', 'bg'], 'nontext');
add('border.error', ['surface', 'bg'], 'nontext');
add('tone.critical.solid', ['surface', 'bg'], 'nontext', { surface: { light: 3.79 } });
add('tone.success.solid', ['surface', 'bg'], 'nontext', { surface: { light: 3.32 } });
// Tone map icons (IconTile): on their own soft and on cards.
add('tone.critical.icon', ['tone.critical.soft', 'surface'], 'nontext');
add('tone.warning.icon', ['tone.warning.soft', 'surface'], 'nontext', { surface: { light: 5.05 } });
add('tone.success.icon', ['tone.success.soft', 'surface'], 'nontext');
add('tone.info.icon', ['tone.info.soft', 'surface'], 'nontext');
add('tone.neutral.icon', ['tone.neutral.soft', 'surface'], 'nontext');
add('tone.primary.icon', ['tone.primary.soft', 'surface'], 'nontext');
add('tone.success.onGradient', ['surfaceInk'], 'nontext');
addGradient('tone.success.onGradient', 'night', 0.6, 'nontext', { light: 10.18, dark: 10.18 });
add('toast.icon', ['toast.bg'], 'nontext');
add('toast.iconError', ['toast.bg'], 'nontext', { 'toast.bg': { light: 7.25 } });

export const contrastPairs: readonly ContrastPair[] = pairs;

/**
 * Tokens that must never carry informational text: they fail AA by design and exist for
 * decoration, disabled states and chevrons only (DEV-01).
 */
export const DECORATIVE_ONLY: readonly ColorPath[] = [
  'text.tertiary',
  'text.disabled',
  'icon.chevron',
];

/** The opaque background colour a pair is measured against. */
export function pairBackground(scheme: ColorSchemeName, bg: ContrastBackground): Rgba {
  if ('gradient' in bg) return sampleGradient(gradient[bg.gradient], bg.at);
  const base = parseColor(colorAt(scheme, bg.over ?? 'bg'));
  if (base.a !== 1) throw new Error(`Base colour for ${bg.color} must be opaque`);
  return composite(parseColor(colorAt(scheme, bg.color)), base);
}

/** WCAG contrast ratio of a pair in one scheme (translucent tokens are composited first). */
export function pairContrast(scheme: ColorSchemeName, pair: ContrastPair): number {
  const bg = pairBackground(scheme, pair.bg);
  const fg = composite(parseColor(colorAt(scheme, pair.fg)), bg);
  return contrastRatio(fg, bg);
}
