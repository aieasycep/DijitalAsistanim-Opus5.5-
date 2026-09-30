/**
 * `Text` (DESIGN_AUDIT §2.7, §3.1): the design type scale with Dynamic Type (`allowFontScaling`
 * with the per-token `maxFontSizeMultiplier`), per-weight Geist/Lora families, tabular numerals,
 * semantic tones only, and Turkish-aware capitals for caps tokens (kicker, typeLabel) — never
 * `textTransform: 'uppercase'`, which turns "i" into "I" instead of "İ".
 */
import { typography, type TypographyName } from '@da/design-tokens';
import { Children, type JSX, type ReactNode } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { textStyleFor } from '../theme/fonts.ts';
import { MAX_TOTAL_FONT_SCALE, useTextScale, useUpper } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import type { Theme } from '../theme/theme.ts';

/** Semantic text colours. Tone names map to the §2.4 tone map's text colour. */
export const TEXT_TONES = [
  'primary',
  'secondary',
  'secondaryOnTrack',
  'tertiaryStrong',
  'disabled',
  'link',
  'accent',
  'onPrimary',
  'onInk',
  'onAiGlow',
  'onGradient',
  'onGradientSecondary',
  'onGradientTertiary',
  'countOnDawn',
  'kickerOnIndigo',
  'critical',
  'warning',
  'success',
  'info',
  'neutral',
  'brand',
  'successDeep',
  'toast',
  'toastAction',
  'inverse',
] as const;
export type TextTone = (typeof TEXT_TONES)[number];

/**
 * The app multiplier applied to a token and the OS cap left for it, so that the total scale
 * (multiplier × Dynamic Type) never exceeds the token's `maxScale` (itself ≤ 2).
 */
export function scaledType(
  maxScale: number,
  appScale: number,
): { readonly factor: number; readonly maxFontSizeMultiplier: number } {
  const cap = Math.min(maxScale, MAX_TOTAL_FONT_SCALE);
  const factor = Math.min(appScale, cap);
  return { factor, maxFontSizeMultiplier: Math.max(1, cap / factor) };
}

/** Resolves a text tone in a theme. */
export function textColor(theme: Theme, tone: TextTone): string {
  const c = theme.color;
  switch (tone) {
    case 'critical':
    case 'warning':
    case 'success':
    case 'info':
    case 'neutral':
      return theme.tone[tone].text;
    case 'brand':
      return theme.tone.primary.text;
    case 'successDeep':
      return c.tone.success.deep;
    case 'toast':
      return c.toast.text;
    case 'toastAction':
      return c.toast.action;
    case 'inverse':
      return c.inverse.text;
    default:
      return c.text[tone];
  }
}

export interface TextProps extends Omit<RNTextProps, 'style'> {
  /** Type token (default `body`). */
  readonly variant?: TypographyName;
  /** Semantic colour (default `primary`; `secondary` for the `secondary` variant). */
  readonly tone?: TextTone;
  /** Weight override within the token's family (e.g. bold spans). */
  readonly weight?: 400 | 500 | 600 | 700;
  /** Tabular numerals (times, durations, amounts, counters). Tokens may already set it. */
  readonly numeric?: boolean;
  /** Upper-case with the locale rules; defaults to the token's `caps`. */
  readonly caps?: boolean;
  /** Marks the text as a header for screen readers (`accessibilityRole="header"`). */
  readonly heading?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  /** Done items: line-through. */
  readonly strike?: boolean;
  readonly style?: RNTextProps['style'];
  readonly children?: ReactNode;
}

function transformChildren(children: ReactNode, upper: (text: string) => string): ReactNode {
  if (typeof children === 'string') return upper(children);
  return Children.map(children, (child) => (typeof child === 'string' ? upper(child) : child));
}

export function Text({
  variant = 'body',
  tone,
  weight,
  numeric,
  caps,
  heading = false,
  align,
  strike = false,
  style,
  children,
  accessibilityRole,
  ...rest
}: TextProps): JSX.Element {
  const theme = useTheme();
  const upper = useUpper();
  const token = typography[variant];
  const appScale = useTextScale();
  const scaled = scaledType(token.maxScale, appScale);
  const unscaled = textStyleFor(weight === undefined ? token : { ...token, weight });
  const base: TextStyle =
    scaled.factor === 1
      ? unscaled
      : {
          ...unscaled,
          fontSize: token.size * scaled.factor,
          lineHeight: token.lineHeight * scaled.factor,
          ...(typeof unscaled.letterSpacing === 'number'
            ? { letterSpacing: unscaled.letterSpacing * scaled.factor }
            : {}),
        };
  const resolvedTone: TextTone = tone ?? (variant === 'secondary' ? 'secondary' : 'primary');
  const dynamic: TextStyle = { color: textColor(theme, resolvedTone) };
  if (numeric === true) dynamic.fontVariant = ['tabular-nums'];
  if (align !== undefined) dynamic.textAlign = align;
  if (strike) dynamic.textDecorationLine = 'line-through';
  const upperCase = caps ?? token.caps === true;
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={scaled.factor === 1 ? token.maxScale : scaled.maxFontSizeMultiplier}
      accessibilityRole={heading ? 'header' : accessibilityRole}
      {...rest}
      style={[base, dynamic, style]}
    >
      {upperCase ? transformChildren(children, upper) : children}
    </RNText>
  );
}
