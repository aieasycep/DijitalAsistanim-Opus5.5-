/**
 * Semantic colour tokens for the light and dark schemes (DESIGN_AUDIT §2.2–§2.4, §2.11, §2.16).
 * Components read these semantic keys only. `text.tertiary` is decorative/disabled-only: every
 * informational text uses `text.tertiaryStrong` (DEV-01, enforced by test/contrast.test.ts).
 */
import { alpha, palette } from './palette.ts';

const w = palette.warm;
const wd = palette.warmDark;
const i = palette.indigo;
const c = palette.coral;
const a = palette.amber;
const g = palette.green;
const b = palette.blue;
const av = palette.avatar;

export const COLOR_SCHEMES = ['light', 'dark'] as const;
export type ColorSchemeName = (typeof COLOR_SCHEMES)[number];

/** Fills used on the dawn / night / dusk gradients; identical in both schemes. */
const onGradientFills = {
  fill08: alpha(w.white, 0.08),
  fill10: alpha(w.white, 0.1),
  fill12: alpha(w.white, 0.12),
  fill14: alpha(w.white, 0.14),
  fill16: alpha(w.white, 0.16),
  fill18: alpha(w.white, 0.18),
  fill25: alpha(w.white, 0.25),
  waveIdle: alpha(w.white, 0.35),
} as const;

const light = {
  bg: w.bg,
  bgEditorial: w.paper,
  surface: w.white,
  surfaceSunken: w.sunken,
  surfacePressed: w.pressed,
  surfaceInk: w.ink,
  surfaceTrack: w.track,
  text: {
    primary: w.ink,
    secondary: w.secondary,
    secondaryOnTrack: w.secondaryOnTrack,
    tertiary: w.tertiary,
    tertiaryStrong: w.tertiaryStrong,
    disabled: w.disabled,
    link: i.onSoft,
    accent: i.primary,
    onPrimary: w.white,
    onInk: w.white,
    onAiGlow: w.onAiGlow,
    onGradient: w.white,
    onGradientSecondary: alpha(w.white, 0.86),
    onGradientTertiary: alpha(w.white, 0.72),
    countOnDawn: i.countOnDawn,
    kickerOnIndigo: i.kickerOnIndigo,
  },
  icon: {
    default: w.secondary,
    idle: w.idle,
    chevron: w.quaternary,
    ai: i.primary,
  },
  brand: {
    primary: i.primary,
    primaryPressed: i.primaryPressed,
    soft: i.soft,
    softPressed: i.softPressed,
    onSoft: i.onSoft,
    glow: i.glow,
  },
  tone: {
    critical: {
      solid: c.base,
      soft: c.soft,
      text: c.text,
      textStrong: c.textStrong,
      icon: c.base,
      pressed: c.pressed,
    },
    warning: { solid: a.base, soft: a.soft, text: a.text, icon: a.text },
    success: {
      solid: g.base,
      soft: g.soft,
      text: g.text,
      icon: g.text,
      deep: g.deep,
      onGradient: g.onGradient,
    },
    info: { solid: b.base, soft: b.soft, text: b.text, icon: b.text },
    neutral: { solid: w.tertiary, soft: w.sunken, text: w.secondary, icon: w.secondary },
    primary: { solid: i.primary, soft: i.soft, text: i.onSoft, icon: i.primary },
  },
  border: {
    hairline: alpha(w.shadowInk, 0.06),
    row: alpha(w.shadowInk, 0.07),
    strong: alpha(w.shadowInk, 0.1),
    control: alpha(w.shadowInk, 0.2),
    gapDashed: alpha(w.shadowInk, 0.15),
    focus: i.primary,
    error: c.base,
    selected: i.primary,
    suggested: i.glow,
    planned: i.primary,
  },
  overlay: {
    scrim: alpha(w.shadowInk, 0.35),
    tabBar: alpha(w.white, 0.92),
    tabBarOpaque: w.white,
    glassCard: alpha(w.white, 0.7),
  },
  tabBar: { active: i.primary, inactive: w.tertiaryStrong },
  swipe: { completeBg: g.text, completeText: w.white },
  onGradient: onGradientFills,
  aiGlow: { from: i.glowStart, to: w.white },
  control: {
    switchOn: i.primary,
    switchOff: w.switchOff,
    switchOffBorder: w.idle,
    radioOff: w.idle,
    knob: w.white,
    grabber: w.grabber,
    spinnerTrack: i.weekMeeting,
  },
  skeleton: { base: w.skeleton, highlight: w.pressed },
  inverse: { bg: w.ink, text: w.white },
  button: {
    destructive: { bg: c.text, text: w.white, pressed: c.pressed },
  },
  toast: { bg: w.ink, text: w.white, icon: i.glow, iconError: c.light, action: i.glow },
  plan: {
    event: w.white,
    ai: i.suggested,
    aiPlanned: i.soft,
    life: a.lifeSurface,
    week: {
      meeting: i.weekMeeting,
      focus: i.soft,
      busy: c.busy,
      busyStrong: c.base,
      today: i.primary,
      todayStrong: i.glow,
    },
  },
  mail: {
    band: { attention: i.primary, info: i.band, low: w.track },
  },
  avatar: {
    peach: { bg: av.peachBg, fg: av.peachFg },
    blue: { bg: av.blueBg, fg: av.blueFg },
    green: { bg: av.greenBg, fg: av.greenFg },
    neutral: { bg: w.sunken, fg: w.secondary },
    self: { bg: w.ink, fg: w.white },
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every scheme must have (dark is checked against light at compile time). */
export type SemanticColors = Widen<typeof light>;

type LeafPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : LeafPaths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Dot path of every colour leaf, e.g. `'text.tertiaryStrong'` or `'tone.critical.soft'`. */
export type ColorPath = LeafPaths<SemanticColors>;

const dark: SemanticColors = {
  bg: wd.bg,
  bgEditorial: wd.bg,
  surface: wd.surface,
  surfaceSunken: alpha(w.white, 0.08),
  surfacePressed: wd.pressed,
  surfaceInk: wd.surface,
  surfaceTrack: alpha(w.white, 0.08),
  text: {
    primary: wd.text,
    secondary: wd.secondary,
    secondaryOnTrack: wd.secondary,
    tertiary: wd.tertiary,
    tertiaryStrong: wd.tertiaryStrong,
    disabled: wd.disabled,
    link: i.glow,
    accent: i.glow,
    onPrimary: i.onPrimaryDark,
    onInk: wd.text,
    onAiGlow: wd.onAiGlow,
    onGradient: w.white,
    onGradientSecondary: alpha(w.white, 0.86),
    onGradientTertiary: alpha(w.white, 0.72),
    countOnDawn: i.countOnDawn,
    kickerOnIndigo: i.kickerOnIndigo,
  },
  icon: {
    default: wd.secondary,
    idle: wd.idle,
    chevron: wd.disabled,
    ai: i.glow,
  },
  brand: {
    primary: i.primaryDark,
    primaryPressed: i.primaryPressedDark,
    soft: alpha(i.primaryDark, 0.16),
    softPressed: alpha(i.primaryDark, 0.24),
    onSoft: i.tonalTextDark,
    glow: i.glow,
  },
  tone: {
    critical: {
      solid: c.light,
      soft: alpha(c.base, 0.18),
      text: c.light,
      textStrong: c.light,
      icon: c.light,
      pressed: c.pressedDark,
    },
    warning: { solid: a.light, soft: alpha(a.tint, 0.18), text: a.light, icon: a.light },
    success: {
      solid: g.light,
      soft: alpha(g.base, 0.18),
      text: g.light,
      icon: g.light,
      deep: g.light,
      onGradient: g.onGradient,
    },
    info: { solid: b.light, soft: alpha(b.base, 0.18), text: b.light, icon: b.light },
    neutral: {
      solid: wd.tertiary,
      soft: alpha(w.white, 0.08),
      text: wd.secondary,
      icon: wd.secondary,
    },
    primary: {
      solid: i.primaryDark,
      soft: alpha(i.primaryDark, 0.16),
      text: i.tonalTextDark,
      icon: i.glow,
    },
  },
  border: {
    hairline: alpha(w.white, 0.06),
    row: alpha(w.white, 0.07),
    strong: alpha(w.white, 0.1),
    control: alpha(w.white, 0.2),
    gapDashed: alpha(w.white, 0.15),
    focus: i.glow,
    error: c.light,
    selected: i.primaryDark,
    suggested: i.primaryDark,
    planned: i.primaryDark,
  },
  overlay: {
    scrim: alpha(w.black, 0.5),
    tabBar: alpha(wd.bg, 0.92),
    tabBarOpaque: wd.bg,
    glassCard: alpha(wd.surface, 0.8),
  },
  tabBar: { active: i.glow, inactive: wd.tertiaryStrong },
  swipe: { completeBg: g.text, completeText: w.white },
  onGradient: onGradientFills,
  aiGlow: { from: alpha(i.primaryDark, 0.28), to: wd.surface },
  control: {
    switchOn: i.primaryDark,
    switchOff: alpha(w.white, 0.16),
    switchOffBorder: wd.idle,
    radioOff: wd.idle,
    knob: wd.text,
    grabber: alpha(w.white, 0.16),
    spinnerTrack: alpha(i.primaryDark, 0.24),
  },
  skeleton: { base: alpha(w.white, 0.06), highlight: alpha(w.white, 0.1) },
  inverse: { bg: wd.text, text: wd.bg },
  button: {
    destructive: { bg: c.light, text: wd.bg, pressed: c.pressedDark },
  },
  toast: { bg: wd.pressed, text: wd.text, icon: i.glow, iconError: c.light, action: i.glow },
  plan: {
    event: wd.surface,
    ai: alpha(i.primaryDark, 0.12),
    aiPlanned: alpha(i.primaryDark, 0.2),
    life: alpha(a.light, 0.1),
    week: {
      meeting: alpha(i.primaryDark, 0.35),
      focus: alpha(i.primaryDark, 0.16),
      busy: alpha(c.base, 0.35),
      busyStrong: c.light,
      today: i.primaryDark,
      todayStrong: i.glow,
    },
  },
  mail: {
    band: {
      attention: i.primaryDark,
      info: alpha(i.primaryDark, 0.35),
      low: alpha(w.white, 0.08),
    },
  },
  avatar: {
    peach: { bg: av.peachFg, fg: av.peachBg },
    blue: { bg: av.blueFg, fg: av.blueBg },
    green: { bg: av.greenFg, fg: av.greenBg },
    neutral: { bg: w.secondary, fg: w.sunken },
    self: { bg: wd.text, fg: wd.bg },
  },
};

export const color: { readonly light: SemanticColors; readonly dark: SemanticColors } = {
  light,
  dark,
};

export const TONES = ['critical', 'warning', 'success', 'info', 'neutral', 'primary'] as const;
export type Tone = (typeof TONES)[number];

export interface ToneColors {
  readonly soft: string;
  readonly text: string;
  readonly icon: string;
}

/**
 * Tone map API for `Badge`, `IconTile`, `StatusPill` and `ToneText` (DESIGN_AUDIT §2.4):
 * `[soft background, text, icon]`. Critical text uses `textStrong` (DEV-02).
 */
export function toneColors(scheme: ColorSchemeName, tone: Tone): ToneColors {
  const t = color[scheme].tone[tone];
  const text = 'textStrong' in t ? t.textStrong : t.text;
  return { soft: t.soft, text, icon: t.icon };
}

/** Resolves a dot path (see {@link ColorPath}) in one scheme. */
export function colorAt(scheme: ColorSchemeName, path: ColorPath): string {
  let node: unknown = color[scheme];
  for (const key of path.split('.')) {
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'string') throw new Error(`Unknown colour path: ${path}`);
  return node;
}

/** Every colour leaf of a scheme in declaration order: `[path, value]`. */
export function flattenColors(scheme: ColorSchemeName): [ColorPath, string][] {
  const out: [ColorPath, string][] = [];
  const walk = (node: object, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (typeof value === 'string') out.push([path as ColorPath, value]);
      else walk(value as object, path);
    }
  };
  walk(color[scheme], '');
  return out;
}
