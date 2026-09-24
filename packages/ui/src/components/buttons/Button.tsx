/**
 * `Button` (DESIGN_AUDIT §3.2). Heights (verbatim P:01): "52 (sayfa altı CTA), 48 (kart içi),
 * 40–42 (satır içi), 36 (ghost)". States: "Pressed: scale .97 + ton koyulaşır, 120 ms. Loading:
 * metin '…' ile devam eder, spinner soldan; buton kilitlenir." Disabled = opacity .4.
 *
 * Variants: `primary`, `tonal`, `neutralTonal`, `ink` (dark: becomes primary), `surface`,
 * `destructive`, `inverse` (on gradients), `ghost` (brand text) and `ghostSecondary`, `text`
 * (44 pt secondary text button under CTAs). Labels come from the caller (i18n).
 */
import type { JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale, type PressableA11yProps } from '../../primitives/PressableScale.tsx';
import { Spinner, type SpinnerTone } from '../../primitives/Spinner.tsx';
import { Text } from '../../primitives/Text.tsx';
import { makeStyles } from '../../theme/makeStyles.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { Theme } from '../../theme/theme.ts';

export const BUTTON_VARIANTS = [
  'primary',
  'tonal',
  'neutralTonal',
  'ink',
  'surface',
  'destructive',
  'inverse',
  'ghost',
  'ghostSecondary',
  'text',
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** `lg` 52/16, `md` 48/14, `inline` 42/12, `sm` 40/12, `card` 38/12, `xs` 36/12 (chat), `ghost` 36/10. */
export const BUTTON_SIZES = ['lg', 'md', 'inline', 'sm', 'card', 'xs', 'ghost'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const HEIGHT: Record<ButtonSize, number> = {
  lg: 52,
  md: 48,
  inline: 42,
  sm: 40,
  card: 38,
  xs: 36,
  ghost: 36,
};
const RADIUS: Record<ButtonSize, number> = {
  lg: 16,
  md: 14,
  inline: 12,
  sm: 12,
  card: 12,
  xs: 12,
  ghost: 10,
};

interface VariantColors {
  readonly bg: string | undefined;
  readonly pressed: string | undefined;
  readonly fg: string;
  readonly spinner: SpinnerTone;
}

export function buttonColors(theme: Theme, variant: ButtonVariant): VariantColors {
  const c = theme.color;
  switch (variant) {
    case 'primary':
      return {
        bg: c.brand.primary,
        pressed: c.brand.primaryPressed,
        fg: c.text.onPrimary,
        spinner: 'onPrimary',
      };
    case 'tonal':
      return {
        bg: c.brand.soft,
        pressed: c.brand.softPressed,
        fg: c.brand.onSoft,
        spinner: 'onSoft',
      };
    case 'neutralTonal':
      return {
        bg: c.surfaceSunken,
        pressed: c.surfaceTrack,
        fg: c.text.secondary,
        spinner: 'ink',
      };
    case 'ink':
      // Dark: the ink CTA becomes the dark primary (§2.16 rule 3).
      return theme.isDark
        ? {
            bg: c.brand.primary,
            pressed: c.brand.primaryPressed,
            fg: c.text.onPrimary,
            spinner: 'onPrimary',
          }
        : // No darker ink token exists; the pressed ink CTA keeps its fill and scales (.97).
          { bg: c.inverse.bg, pressed: c.inverse.bg, fg: c.inverse.text, spinner: 'onPrimary' };
    case 'surface':
      return { bg: c.surface, pressed: c.surfaceSunken, fg: c.text.primary, spinner: 'ink' };
    case 'destructive':
      return {
        bg: c.button.destructive.bg,
        pressed: c.button.destructive.pressed,
        fg: c.button.destructive.text,
        spinner: 'onDestructive',
      };
    case 'inverse':
      return {
        bg: c.text.onGradient,
        pressed: c.onGradient.fill25,
        fg: c.brand.onSoft,
        spinner: 'onSoft',
      };
    case 'ghost':
      return { bg: undefined, pressed: c.brand.soft, fg: c.text.link, spinner: 'onSoft' };
    case 'ghostSecondary':
    case 'text':
      return { bg: undefined, pressed: c.surfaceSunken, fg: c.text.secondary, spinner: 'ink' };
  }
}

const useStyles = makeStyles((theme) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[2],
    alignSelf: 'flex-start',
  },
  full: { alignSelf: 'stretch' },
  flex: { flex: 1, alignSelf: 'auto' },
  content: { flexDirection: 'row', alignItems: 'center', gap: theme.space[2] },
}));

export interface ButtonProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly iconFilled?: boolean;
  readonly disabled?: boolean;
  /** Spinner on the left, `loadingLabel` ("Gönderiliyor…") shown and announced; locks the button. */
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Stretch to the container width. */
  readonly fullWidth?: boolean;
  /** Take the remaining row space (`flex: 1`). */
  readonly flex?: boolean;
  /** Page CTA glow (`shadow.ctaPrimary` / `ctaInk`). */
  readonly pageCta?: boolean;
  /** Custom horizontal padding (e.g. hero "Dinle" 0/16/0/12). */
  readonly paddingHorizontal?: number;
  readonly style?: StyleProp<ViewStyle>;
}

function labelVariant(size: ButtonSize): 'labelLg' | 'label' | 'labelSm' {
  if (size === 'lg' || size === 'md') return 'labelLg';
  if (size === 'card' || size === 'xs') return 'labelSm';
  return 'label';
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconFilled = false,
  disabled = false,
  loading = false,
  loadingLabel,
  fullWidth = false,
  flex = false,
  pageCta = false,
  paddingHorizontal,
  style,
  accessibilityLabel,
  testID,
  ...a11y
}: ButtonProps): JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  const colors = buttonColors(theme, variant);
  const height = variant === 'text' ? 44 : HEIGHT[size];
  const radius = variant === 'text' ? theme.radius.button : RADIUS[size];
  const ghostLike = variant === 'ghost' || variant === 'ghostSecondary' || variant === 'text';
  const padX = paddingHorizontal ?? (ghostLike ? 10 : size === 'lg' || size === 'md' ? 20 : 16);
  const shownLabel = loading && loadingLabel !== undefined ? loadingLabel : label;
  const shadow =
    variant === 'surface'
      ? theme.elevation('s1Control')
      : pageCta && (variant === 'primary' || variant === 'ink')
        ? theme.elevation(variant === 'ink' ? 'ctaInk' : 'ctaPrimary')
        : null;
  const iconSize = size === 'card' || size === 'xs' ? 16 : 20;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.button.${variant}`}
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      accessibilityLabel={accessibilityLabel ?? shownLabel}
      visualSize={{ width: height, height }}
      pressedStyle={colors.pressed === undefined ? null : { backgroundColor: colors.pressed }}
      style={[
        styles.base,
        fullWidth ? styles.full : null,
        flex ? styles.flex : null,
        {
          minHeight: height,
          borderRadius: radius,
          paddingHorizontal: padX,
          backgroundColor: colors.bg,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        shadow,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <Spinner size={16} tone={colors.spinner} />
        ) : icon !== undefined ? (
          <Icon name={icon} size={iconSize} color={colors.fg} filled={iconFilled} />
        ) : null}
        <Text variant={labelVariant(size)} style={{ color: colors.fg }} numberOfLines={2}>
          {shownLabel}
        </Text>
      </View>
    </PressableScale>
  );
}
