/**
 * Surfaces (DESIGN_AUDIT §3.1, §2.10, §2.16): `Surface`/`Card` (light = surface + shadow, dark =
 * surface + 6% white hairline ring; never a hard-coded white), `AiGlowSurface` (radial glow from a
 * corner), `InkSurface` (ink callouts; dark = surface + .08 ring), `GradientSurface` (dawn, night,
 * dusk, prep), `Divider` and `IllustrationFrame` (non-interactive product illustrations).
 */
import type { GradientName, RadiusName, ShadowName } from '@da/design-tokens';
import type { JSX, ReactNode } from 'react';
import {
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { hiddenFromA11y } from '../theme/a11y.ts';
import { useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import type { Theme } from '../theme/theme.ts';
import { GradientFill } from './GradientFill.tsx';
import { PressableScale } from './PressableScale.tsx';

export type SurfaceBackground =
  'surface' | 'bg' | 'sunken' | 'pressed' | 'ink' | 'editorial' | 'track' | 'transparent';

/** Padding as a number or the CSS shorthand `[top, horizontal, bottom]` / `[vertical, horizontal]`. */
export type Padding =
  | number
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export function paddingStyle(padding: Padding | undefined): ViewStyle {
  if (padding === undefined) return {};
  if (typeof padding === 'number') return { padding };
  if (padding.length === 2) return { paddingVertical: padding[0], paddingHorizontal: padding[1] };
  if (padding.length === 3) {
    return { paddingTop: padding[0], paddingHorizontal: padding[1], paddingBottom: padding[2] };
  }
  return {
    paddingTop: padding[0],
    paddingRight: padding[1],
    paddingBottom: padding[2],
    paddingLeft: padding[3],
  };
}

export function surfaceColor(theme: Theme, background: SurfaceBackground): string | undefined {
  const c = theme.color;
  switch (background) {
    case 'surface':
      return c.surface;
    case 'bg':
      return c.bg;
    case 'sunken':
      return c.surfaceSunken;
    case 'pressed':
      return c.surfacePressed;
    case 'ink':
      return c.surfaceInk;
    case 'editorial':
      return c.bgEditorial;
    case 'track':
      return c.surfaceTrack;
    case 'transparent':
      return undefined;
  }
}

export interface SurfaceProps extends Omit<ViewProps, 'style'> {
  /** Shadow token (dark renders the ring); `none` for flat surfaces. Default `card`. */
  readonly elevation?: ShadowName | 'none';
  /** Corner radius token (default `card` = 20). */
  readonly radius?: RadiusName;
  readonly padding?: Padding;
  readonly background?: SurfaceBackground;
  /** Show the pressed fill (`surfacePressed`). */
  readonly pressed?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}

export function Surface({
  elevation = 'card',
  radius = 'card',
  padding,
  background = 'surface',
  pressed = false,
  style,
  children,
  ...rest
}: SurfaceProps): JSX.Element {
  const theme = useTheme();
  const fill = pressed ? theme.color.surfacePressed : surfaceColor(theme, background);
  return (
    <View
      {...rest}
      style={[
        { borderRadius: theme.radius[radius], backgroundColor: fill },
        elevation === 'none' ? null : theme.elevation(elevation),
        background === 'ink' && theme.isDark ? theme.elevation('s1Control') : null,
        paddingStyle(padding),
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface CardProps extends SurfaceProps {
  /** Makes the whole card a button (scale .98 + pressed fill). Requires a composed label. */
  readonly onPress?: () => void;
  readonly onLongPress?: () => void;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly accessibilityActions?: readonly AccessibilityActionInfo[];
  readonly onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  /** Selected ring (`0 0 0 2px brand.primary`). */
  readonly selected?: boolean;
}

/** Card: `surface`, radius 20, padding 16, `shadow.card` (dark ring). Optionally pressable. */
export function Card({
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  selected = false,
  elevation = 'card',
  radius = 'card',
  padding = 16,
  background = 'surface',
  style,
  children,
  testID,
  ...rest
}: CardProps): JSX.Element {
  const theme = useTheme();
  const base: StyleProp<ViewStyle> = [
    { borderRadius: theme.radius[radius], backgroundColor: surfaceColor(theme, background) },
    elevation === 'none' ? null : theme.elevation(elevation),
    selected ? theme.elevation('selectedRing') : null,
    paddingStyle(padding),
    style,
  ];
  if (onPress === undefined && onLongPress === undefined) {
    // A labelled card is one accessibility element; its controls are reached through the
    // `accessibilityActions` the card components compose (every button is mirrored there).
    return (
      <View
        {...rest}
        testID={testID}
        accessible={accessibilityLabel !== undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={onAccessibilityAction}
        style={base}
      >
        {children}
      </View>
    );
  }
  return (
    <PressableScale
      feedback="card"
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityState={{ selected }}
      pressedStyle={{ backgroundColor: theme.color.surfacePressed }}
      testID={testID}
      style={base}
    >
      {children}
    </PressableScale>
  );
}

export interface AiGlowSurfaceProps extends Omit<SurfaceProps, 'background'> {
  /** Corner the glow radiates from: `tl` (AI cards) or `tr` (Today hero, stop 58%). */
  readonly origin?: 'tl' | 'tr';
}

/** Radial AI glow (`ai-glow-tl/-tr`, dark: indigo 28% → surface + ring). */
export function AiGlowSurface({
  origin = 'tl',
  elevation = 'card',
  radius = 'card',
  padding = 16,
  style,
  children,
  ...rest
}: AiGlowSurfaceProps): JSX.Element {
  const theme = useTheme();
  const r = theme.radius[radius];
  return (
    <View
      {...rest}
      style={[
        { borderRadius: r, backgroundColor: theme.color.surface },
        elevation === 'none' ? null : theme.elevation(elevation),
        style,
      ]}
    >
      <View style={{ borderRadius: r, overflow: 'hidden', ...paddingStyle(padding) }}>
        <GradientFill
          gradient={
            origin === 'tl' ? theme.gradients.aiGlowTopLeft : theme.gradients.aiGlowTopRight
          }
          radius={r}
        />
        {children}
      </View>
    </View>
  );
}

/** Ink callout base: light = the ink surface; dark = surface + .08 ring (DEV-14). */
export function InkSurface({
  radius = 'list',
  padding = [14, 16],
  elevation = 'none',
  ...rest
}: Omit<SurfaceProps, 'background'>): JSX.Element {
  return (
    <Surface {...rest} radius={radius} padding={padding} elevation={elevation} background="ink" />
  );
}

export interface GradientSurfaceProps extends Omit<
  SurfaceProps,
  'background' | 'elevation' | 'radius'
> {
  readonly gradient: GradientName;
  /** Corner radius token, or `none` for full-bleed headers. Default `hero` (28). */
  readonly radius?: RadiusName | 'none';
}

/**
 * Dawn / night / dusk / prep gradient surface (identical in both schemes). Text on it uses the
 * `onGradient*` tones only, per the §2.6 text-safe rule ({@link onGradientTone}).
 */
export function GradientSurface({
  gradient,
  radius = 'hero',
  padding,
  style,
  children,
  ...rest
}: GradientSurfaceProps): JSX.Element {
  const theme = useTheme();
  const r = radius === 'none' ? 0 : theme.radius[radius];
  return (
    <View {...rest} style={[{ borderRadius: r, overflow: 'hidden' }, paddingStyle(padding), style]}>
      <GradientFill gradient={theme.fixedGradients[gradient]} radius={r} />
      {children}
    </View>
  );
}

/**
 * The text-safe tone for small text on dawn/dusk at gradient position `t` (0 top → 1 bottom):
 * secondary (.86) only where t ≤ 0.8, kickers (.72) only where t ≤ 0.6; below that, full white.
 */
export function onGradientTone(
  t: number,
  role: 'secondary' | 'kicker',
): 'onGradient' | 'onGradientSecondary' | 'onGradientTertiary' {
  if (role === 'kicker') return t <= 0.6 ? 'onGradientTertiary' : 'onGradient';
  return t <= 0.8 ? 'onGradientSecondary' : 'onGradient';
}

export interface DividerProps {
  readonly variant?: 'hairline' | 'row' | 'strong';
  /** Horizontal inset (e.g. after a leading tile). */
  readonly inset?: number;
  readonly style?: StyleProp<ViewStyle>;
}

/** 1 px divider (exactly 1 px, not `hairlineWidth`), hidden from assistive technology. */
export function Divider({ variant = 'hairline', inset = 0, style }: DividerProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      {...hiddenFromA11y}
      style={[
        { height: 1, marginLeft: inset, backgroundColor: theme.color.border[variant] },
        style,
      ]}
    />
  );
}

export interface IllustrationFrameProps {
  /** The single description read by screen readers. */
  readonly accessibilityLabel: string;
  /** Tilt in degrees (±1.5–2); removed under reduce motion. */
  readonly tilt?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}

/**
 * Wraps non-interactive product parts shown as illustrations (onboarding 2.2–2.4): no touch, one
 * description, children hidden from assistive technology, `shadow.float`.
 */
export function IllustrationFrame({
  accessibilityLabel,
  tilt = 0,
  style,
  children,
}: IllustrationFrameProps): JSX.Element {
  const theme = useTheme();
  const { reduceMotion } = useMotion();
  const rotate = reduceMotion || tilt === 0 ? undefined : [{ rotate: `${String(tilt)}deg` }];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
      style={[theme.elevation('float'), rotate === undefined ? null : { transform: rotate }, style]}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
    </View>
  );
}
