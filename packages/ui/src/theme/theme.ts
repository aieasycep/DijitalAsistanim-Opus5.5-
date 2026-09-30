/**
 * The resolved theme object (ADR-03): one immutable object per colour scheme, built once from
 * `@da/design-tokens`. Components read semantic keys from it through `useTheme()` and never import
 * raw colours. Light cards get drop shadows; dark cards get the 6% white hairline ring instead
 * (DESIGN_AUDIT §2.10, §2.16).
 */
import {
  androidElevation,
  color,
  gradient,
  layout,
  motion,
  opacity,
  radius,
  shadow,
  shadowToCss,
  size,
  space,
  themedGradients,
  toneColors,
  typography,
  zIndex,
  type ColorSchemeName,
  type SemanticColors,
  type ShadowName,
  type ThemedGradients,
  type Tone,
  type ToneColors,
} from '@da/design-tokens';
import { Platform, type ViewStyle } from 'react-native';

export type { ColorSchemeName, ShadowName, Tone, ToneColors };

export interface Theme {
  readonly scheme: ColorSchemeName;
  readonly isDark: boolean;
  /** Semantic colours of this scheme (`theme.color.text.tertiaryStrong`, …). */
  readonly color: SemanticColors;
  /** Tone map (`[soft, text, icon]`, DESIGN_AUDIT §2.4) for badges, tiles and pills. */
  readonly tone: Readonly<Record<Tone, ToneColors>>;
  /** Scheme-dependent gradients (AI glow, fade-to-bg, onboarding tint, skeleton shimmer). */
  readonly gradients: ThemedGradients;
  /** Scheme-independent gradients (dawn, night, dusk, prep card). */
  readonly fixedGradients: typeof gradient;
  readonly typography: typeof typography;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly size: typeof size;
  readonly layout: typeof layout;
  readonly motion: typeof motion;
  readonly opacity: typeof opacity;
  readonly zIndex: typeof zIndex;
  /**
   * The elevation style of a shadow token in this scheme: a `boxShadow` string (New
   * Architecture). Light tokens are drop shadows, dark tokens are hairline rings. Android API < 28
   * cannot draw outset box shadows, so drops become `elevation` and rings a 1 px border there.
   */
  readonly elevation: (name: ShadowName) => ViewStyle;
}

const NO_ELEVATION: ViewStyle = {};

/** True on Android versions that cannot render an outset `boxShadow` (API < 28). */
function legacyAndroid(): boolean {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 28;
}

function buildElevations(scheme: ColorSchemeName): Readonly<Record<ShadowName, ViewStyle>> {
  const out = {} as Record<ShadowName, ViewStyle>;
  const tokens = shadow[scheme];
  for (const name of Object.keys(tokens) as ShadowName[]) {
    const token = tokens[name];
    if (token.length === 0) {
      out[name] = NO_ELEVATION;
      continue;
    }
    if (legacyAndroid()) {
      const ring = token.find((layer) => layer.blur === 0 && layer.x === 0 && layer.y === 0);
      out[name] =
        ring !== undefined
          ? { borderWidth: ring.spread, borderColor: ring.color }
          : { elevation: androidElevation[name] };
      continue;
    }
    out[name] = { boxShadow: shadowToCss(token) };
  }
  return out;
}

function createTheme(scheme: ColorSchemeName): Theme {
  const elevations = buildElevations(scheme);
  const tones = {
    critical: toneColors(scheme, 'critical'),
    warning: toneColors(scheme, 'warning'),
    success: toneColors(scheme, 'success'),
    info: toneColors(scheme, 'info'),
    neutral: toneColors(scheme, 'neutral'),
    primary: toneColors(scheme, 'primary'),
  } as const;
  return {
    scheme,
    isDark: scheme === 'dark',
    color: color[scheme],
    tone: tones,
    gradients: themedGradients(scheme),
    fixedGradients: gradient,
    typography,
    space,
    radius,
    size,
    layout,
    motion,
    opacity,
    zIndex,
    elevation: (name) => elevations[name],
  };
}

/** Both themes, created once; `useTheme()` returns one of these stable objects. */
export const themes: Readonly<Record<ColorSchemeName, Theme>> = {
  light: createTheme('light'),
  dark: createTheme('dark'),
};
