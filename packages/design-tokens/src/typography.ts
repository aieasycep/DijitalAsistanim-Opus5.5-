/**
 * Typography (DESIGN_AUDIT §2.7). Geist for UI, Lora for editorial narrative only (briefing
 * narrative, reading view, weekly review and share card, commitment quotes, marketing).
 * Tracking is stored in em (the design's percentages); React Native needs points, so
 * {@link letterSpacing} converts (pt = em × size). Uppercase is applied by the i18n layer
 * (`toLocaleUpperCase`), never by `textTransform`.
 */

export type FontFamilyKey = 'sans' | 'serif' | 'mono';
export type FontWeight = 400 | 500 | 600 | 700;

/** React Native family names per weight (Android ignores `fontWeight` on single-file families). */
export const fontFamily = {
  sans: {
    400: 'Geist_400Regular',
    500: 'Geist_500Medium',
    600: 'Geist_600SemiBold',
    700: 'Geist_700Bold',
  },
  serif: {
    400: 'Lora_400Regular',
    500: 'Lora_500Medium',
    600: 'Lora_600SemiBold',
    '400italic': 'Lora_400Regular_Italic',
  },
  mono: { ios: 'Menlo', android: 'monospace' },
} as const;

/** CSS font stacks for web and backoffice (`next/font` exposes `--font-geist` etc.). */
export const fontStack = {
  sans: 'var(--font-geist), -apple-system, "SF Pro Text", system-ui, sans-serif',
  serif: 'var(--font-lora), Georgia, serif',
  mono: 'var(--font-geist-mono), ui-monospace, Menlo, monospace',
} as const;

export interface TextStyleToken {
  readonly family: FontFamilyKey;
  readonly weight: FontWeight;
  readonly italic?: true;
  readonly size: number;
  readonly lineHeight: number;
  /** Tracking in em (e.g. −0.025 for the design's −2.5%). */
  readonly tracking: number;
  /** `maxFontSizeMultiplier` for Dynamic Type (DESIGN_AUDIT §2.7 "mfs"). */
  readonly maxScale: number;
  /** Rendered in capitals by the i18n layer. */
  readonly caps?: true;
  /** Uses tabular numerals (times, durations, amounts, counters). */
  readonly numeric?: true;
}

function style(
  family: FontFamilyKey,
  weight: FontWeight,
  size: number,
  lineHeight: number,
  tracking: number,
  maxScale: number,
  extra: Pick<TextStyleToken, 'italic' | 'caps' | 'numeric'> = {},
): TextStyleToken {
  return { family, weight, size, lineHeight, tracking, maxScale, ...extra };
}

/** Mobile type scale. Declared tokens keep their design names (see aliases.ts). */
export const typography = {
  display: style('sans', 600, 34, 40, -0.025, 1.3),
  titleGradient: style('sans', 600, 32, 38, -0.02, 1.3),
  titleXl: style('sans', 600, 30, 36, -0.025, 1.3),
  h1: style('sans', 600, 28, 34, -0.02, 1.4),
  hero: style('sans', 600, 26, 32, -0.02, 1.3),
  titleLg: style('sans', 600, 24, 30, -0.02, 1.4),
  h2: style('sans', 600, 22, 28, -0.02, 1.4),
  titleMd: style('sans', 600, 20, 26, -0.02, 1.4),
  sheetTitle: style('sans', 600, 19, 24, -0.01, 1.5),
  h3: style('sans', 600, 17, 23, -0.01, 1.5),
  emph: style('sans', 500, 17, 24, -0.01, 1.5),
  h3Sm: style('sans', 600, 16, 22, -0.01, 1.5),
  body: style('sans', 400, 15, 22, 0, 2),
  bodySm: style('sans', 400, 15, 21, 0, 2),
  rowTitle: style('sans', 500, 15, 20, -0.01, 2),
  labelLg: style('sans', 600, 15, 20, 0, 1.5),
  secondary: style('sans', 400, 14, 20, 0, 2),
  label: style('sans', 600, 14, 18, 0, 1.5),
  bodyXs: style('sans', 400, 13, 19, 0, 2),
  labelSm: style('sans', 600, 13, 16, 0, 1.5),
  kicker: style('sans', 600, 12, 16, 0.08, 1.5, { caps: true }),
  kickerAi: style('sans', 600, 12, 16, 0.06, 1.5, { caps: true }),
  labelXs: style('sans', 600, 12, 16, 0, 1.5),
  meta: style('sans', 400, 12, 16, 0, 2),
  badge: style('sans', 700, 11, 14, 0.05, 1.4),
  badgeSm: style('sans', 700, 10, 12, 0.05, 1.4),
  typeLabel: style('sans', 700, 11, 14, 0.06, 1.4, { caps: true }),
  typeLabelLife: style('sans', 700, 11, 14, 0.08, 1.4, { caps: true }),
  tabLabel: style('sans', 500, 11, 13, 0, 1.2),
  numericXl: style('sans', 600, 44, 48, -0.03, 1.3, { numeric: true }),
  editorial: style('serif', 400, 18, 29, 0, 2),
  editorialReading: style('serif', 400, 17, 28, 0, 2),
  editorialQuote: style('serif', 400, 16, 24, 0, 2, { italic: true }),
  editorialKicker: style('serif', 400, 15, 22, 0, 1.6, { italic: true }),
  editorialTitle: style('serif', 500, 30, 36, -0.02, 1.3),
  editorialDisplay: style('serif', 500, 38, 44, -0.02, 1.3),
  /** P:01 declares editorial-display as 34/40 ("Lora 34–38"); the weekly review uses 38/44. */
  editorialDisplaySm: style('serif', 500, 34, 40, -0.02, 1.3),
  editorialNumber: style('serif', 500, 34, 36, -0.02, 1.3, { numeric: true }),
  mono: style('mono', 500, 14, 20, 0, 1.5),
} as const satisfies Record<string, TextStyleToken>;

export type TypographyName = keyof typeof typography;

/** Backoffice density scale (derived; DESIGN_AUDIT §2.7). */
export const backofficeTypography = {
  boPageTitle: style('sans', 600, 22, 28, 0, 1),
  boSection: style('sans', 600, 16, 24, 0, 1),
  boBody: style('sans', 400, 14, 20, 0, 1),
  boTable: style('sans', 400, 13, 18, 0, 1, { numeric: true }),
  boMeta: style('sans', 400, 12, 16, 0, 1),
  boKicker: style('sans', 600, 11, 16, 0.08, 1, { caps: true }),
  boMono: style('mono', 400, 12, 18, 0, 1),
} as const satisfies Record<string, TextStyleToken>;

/** Responsive web marketing scale: `[≥1200 px, 768–1199 px, <768 px]` (derived). */
export const webTypography = {
  webDisplay: [
    style('sans', 600, 64, 68, -0.025, 1),
    style('sans', 600, 48, 52, -0.025, 1),
    style('sans', 600, 40, 44, -0.025, 1),
  ],
  webH2: [
    style('sans', 600, 40, 46, -0.02, 1),
    style('sans', 600, 32, 38, -0.02, 1),
    style('sans', 600, 28, 34, -0.02, 1),
  ],
  webLead: [style('sans', 400, 20, 30, 0, 1)],
  webBody: [style('sans', 400, 17, 28, 0, 1)],
  webKicker: [style('sans', 600, 13, 16, 0.08, 1, { caps: true })],
  webQuote: [style('serif', 400, 28, 40, 0, 1)],
  webLegalBody: [style('sans', 400, 17, 28, 0, 1)],
} as const satisfies Record<string, readonly TextStyleToken[]>;

/** Web breakpoints used by {@link webTypography}. */
export const webBreakpoint = { md: 768, lg: 1200 } as const;
/** Maximum measure of legal body text on web. */
export const webLegalMeasure = 720;

/** Letter spacing in points for React Native (em × size, rounded to 0.01). */
export function letterSpacing(token: TextStyleToken): number {
  return Math.round(token.tracking * token.size * 100) / 100 + 0;
}

/** React Native family name for a token (mono needs the platform). */
export function nativeFontFamily(token: TextStyleToken, platform: 'ios' | 'android'): string {
  if (token.family === 'mono') return fontFamily.mono[platform];
  if (token.family === 'serif') {
    if (token.italic) return fontFamily.serif['400italic'];
    const serifWeight = token.weight === 700 ? 600 : token.weight;
    return fontFamily.serif[serifWeight];
  }
  return fontFamily.sans[token.weight];
}
