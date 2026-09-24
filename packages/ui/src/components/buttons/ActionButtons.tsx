/**
 * Secondary button patterns (DESIGN_AUDIT §3.2, §3.3):
 * - `TextAction` / `CardActions`: the ≤ 2 card text actions ("en fazla 2 aksiyon"), 14/600 (13/600
 *   compact), brand then secondary, gap 14, ghost offset −10.
 * - `ActionTile` / `ActionTileGrid`: Mail 2×2 tiles (56 h, r16).
 * - `AuthProviderButton`: 52/16 sign-in buttons; the official provider mark is passed in (`logo`),
 *   Apple uses `AppleAuthenticationButton` in the app (HIG) and is not drawn here.
 * - `OutlineAddButton`: 48/14 "add" row button.
 * - `HeaderPill`: 34–36 h header pill ("{N} onay", "Ekle", "Hafıza", "Yeni sohbet", "Kişi Ekle").
 */
import type { JSX, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale, type PressableA11yProps } from '../../primitives/PressableScale.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export interface TextActionProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
  /** `primary` = brand link colour, `secondary` = ink secondary. */
  readonly emphasis?: 'primary' | 'secondary';
  /** 13/600 compact (life, calendar-intel, error cards) instead of 14/600. */
  readonly compact?: boolean;
  readonly icon?: IconName;
  readonly trailingIcon?: IconName;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}

/** A ghost text action (36 h, padding 0/10, radius 10; pressed tonal fill). */
export function TextAction({
  label,
  onPress,
  emphasis = 'primary',
  compact = false,
  icon,
  trailingIcon,
  disabled = false,
  loading = false,
  loadingLabel,
  testID,
  accessibilityLabel,
  ...a11y
}: TextActionProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const fg = emphasis === 'primary' ? c.text.link : c.text.secondary;
  const shown = loading && loadingLabel !== undefined ? loadingLabel : label;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.textAction.${emphasis}`}
      accessibilityLabel={accessibilityLabel ?? shown}
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      visualSize={{ width: 44, height: 36 }}
      pressedStyle={{ backgroundColor: emphasis === 'primary' ? c.brand.soft : c.surfaceSunken }}
      style={{
        minHeight: 36,
        paddingHorizontal: 10,
        borderRadius: theme.radius.tile,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      {loading ? <Spinner size={14} tone={emphasis === 'primary' ? 'onSoft' : 'ink'} /> : null}
      {!loading && icon !== undefined ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text variant={compact ? 'labelSm' : 'label'} style={{ color: fg }}>
        {shown}
      </Text>
      {trailingIcon !== undefined ? <Icon name={trailingIcon} size={16} color={fg} /> : null}
    </PressableScale>
  );
}

export interface CardActionsProps {
  /** At most two actions (the design rule); extra actions are not rendered. */
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** The card action row: margin-top 6, ghost offset −10 so the first label aligns with the text. */
export function CardActions({ children, style }: CardActionsProps): JSX.Element {
  const theme = useTheme();
  const l = theme.layout.cardActionRow;
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: l.marginTop,
          // The 36 pt ghost buttons already contain the 8/0 row padding and their own 10 pt
          // side padding, which also provides the spacing between the two labels.
          marginLeft: l.ghostOffset,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface ActionTileProps extends PressableA11yProps {
  readonly label: string;
  readonly icon: IconName;
  readonly onPress: () => void;
  /** The primary tile (brand fill); others are surface tiles with a brand icon. */
  readonly primary?: boolean;
  readonly loading?: boolean;
  readonly disabled?: boolean;
}

export function ActionTile({
  label,
  icon,
  onPress,
  primary = false,
  loading = false,
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: ActionTileProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const fg = primary ? c.text.onPrimary : c.text.primary;
  const iconColor = primary ? c.text.onPrimary : c.icon.ai;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.actionTile.${primary ? 'primary' : 'default'}`}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      pressedStyle={{ backgroundColor: primary ? c.brand.primaryPressed : c.surfacePressed }}
      style={[
        {
          flex: 1,
          minHeight: 56,
          borderRadius: theme.radius.buttonLg,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2.5],
          backgroundColor: primary ? c.brand.primary : c.surface,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        primary ? null : theme.elevation('s1'),
      ]}
    >
      {loading ? (
        <Spinner size={16} tone={primary ? 'onPrimary' : 'primary'} />
      ) : (
        <Icon name={icon} size={20} color={iconColor} />
      )}
      <Text variant="label" style={{ color: fg, flexShrink: 1 }}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface ActionTileGridProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** 2-column grid of `ActionTile`s, gap 10. Pass tiles in reading order. */
export function ActionTileGrid({ children, style }: ActionTileGridProps): JSX.Element {
  const theme = useTheme();
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2.5] }, style]}>
      {children}
    </View>
  );
}

export interface AuthProviderButtonProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
  /** `email` uses the `mail` icon and brand text; `brand` shows the official `logo`. */
  readonly kind: 'brand' | 'email';
  /** The official provider mark (Google "G", Microsoft four squares) supplied by the app. */
  readonly logo?: ReactNode;
  readonly loading?: boolean;
  /** Disabled while another provider is signing in. */
  readonly disabled?: boolean;
}

export function AuthProviderButton({
  label,
  onPress,
  kind,
  logo,
  loading = false,
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: AuthProviderButtonProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const fg = kind === 'email' ? c.text.link : c.text.primary;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.authProviderButton.${kind}`}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      pressedStyle={{ backgroundColor: c.surfaceSunken }}
      style={[
        {
          minHeight: 52,
          borderRadius: theme.radius.buttonLg,
          backgroundColor: c.surface,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space[2.5],
          paddingHorizontal: 20,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        theme.elevation('s1Control'),
      ]}
    >
      {loading ? (
        <Spinner size={16} tone="ink" />
      ) : kind === 'email' ? (
        <Icon name="mail" size={20} color={fg} />
      ) : (
        logo
      )}
      <Text variant="labelLg" style={{ color: fg }}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface OutlineAddButtonProps extends PressableA11yProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

/** 48/14 surface button with `add` 20 and brand text (e.g. "Kural Ekle"). */
export function OutlineAddButton({
  label,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
  ...a11y
}: OutlineAddButtonProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? 'ui.outlineAddButton'}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      pressedStyle={{ backgroundColor: c.surfacePressed }}
      style={[
        {
          minHeight: 48,
          borderRadius: theme.radius.button,
          backgroundColor: c.surface,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space[2],
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        theme.elevation('s1'),
      ]}
    >
      <Icon name="add" size={20} color={c.text.link} />
      <Text variant="label" style={{ color: c.text.link }}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface HeaderPillProps extends PressableA11yProps {
  readonly label: string;
  readonly icon: IconName;
  readonly onPress: () => void;
  /** `brand` text (approvals, "Ekle"), `neutral` text, or `primary` fill ("Kişi Ekle"). */
  readonly tint?: 'brand' | 'neutral' | 'primary';
  /** Collapse to icon + count at narrow widths / large font scale (D-22). */
  readonly compact?: boolean;
  /** Label with the count for screen readers ("2 onay bekliyor"). */
  readonly accessibilityLabel?: string;
}

export function HeaderPill({
  label,
  icon,
  onPress,
  tint = 'brand',
  compact = false,
  testID,
  accessibilityLabel,
  ...a11y
}: HeaderPillProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const primary = tint === 'primary';
  const fg = primary ? c.text.onPrimary : tint === 'brand' ? c.text.link : c.text.secondary;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.headerPill.${tint}`}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      visualSize={{ width: 44, height: 34 }}
      pressedStyle={{ backgroundColor: primary ? c.brand.primaryPressed : c.surfacePressed }}
      style={[
        {
          minHeight: 34,
          borderRadius: theme.radius.pill,
          paddingLeft: 9,
          paddingRight: compact ? 9 : 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          backgroundColor: primary ? c.brand.primary : c.surface,
        },
        primary ? null : theme.elevation('s1'),
      ]}
    >
      <Icon name={icon} size={18} color={fg} />
      <Text variant="labelXs" style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}
