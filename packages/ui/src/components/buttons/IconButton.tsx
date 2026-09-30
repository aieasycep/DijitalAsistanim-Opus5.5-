/**
 * Icon-only controls (DESIGN_AUDIT §3.2). Every one requires `accessibilityLabel` ("Geri",
 * "Kapat", "Diğer seçenekler", …) and grows its 36–40 pt visual size to the 44/48 minimum.
 * - `IconButton`: 36 circle (`surface` + control shadow / dark ring; translucent on gradients);
 *   `mic` 40 primary; `send` 40 ink (dark inverse); `play` 76 white on night; `skip15` 52.
 * - `CardIconAction`: 36 transparent card action (✓ complete / ··· more) with meaning tints.
 */
import type { JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale, type PressableA11yProps } from '../../primitives/PressableScale.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { Theme } from '../../theme/theme.ts';

export const ICON_BUTTON_VARIANTS = [
  'surface',
  'onGradient',
  'onNight',
  'plain',
  'plainOnGradient',
  'mic',
  'send',
  'play',
  'skip15',
] as const;
export type IconButtonVariant = (typeof ICON_BUTTON_VARIANTS)[number];

interface IconButtonLook {
  readonly size: number;
  readonly glyph: number;
  readonly bg: string | undefined;
  readonly fg: string;
  readonly elevation: StyleProp<ViewStyle>;
}

function look(theme: Theme, variant: IconButtonVariant): IconButtonLook {
  const c = theme.color;
  switch (variant) {
    case 'surface':
      return {
        size: 36,
        glyph: 20,
        bg: c.surface,
        fg: c.text.primary,
        elevation: theme.elevation('s1Control'),
      };
    case 'onGradient':
      return {
        size: 36,
        glyph: 20,
        bg: c.onGradient.fill16,
        fg: c.text.onGradient,
        elevation: null,
      };
    case 'onNight':
      return {
        size: 36,
        glyph: 20,
        bg: c.onGradient.fill14,
        fg: c.text.onGradient,
        elevation: null,
      };
    case 'plain':
      return { size: 36, glyph: 22, bg: undefined, fg: c.text.primary, elevation: null };
    case 'plainOnGradient':
      return { size: 36, glyph: 20, bg: undefined, fg: c.text.onGradientTertiary, elevation: null };
    case 'mic':
      return { size: 40, glyph: 20, bg: c.brand.primary, fg: c.text.onPrimary, elevation: null };
    case 'send':
      return { size: 40, glyph: 20, bg: c.inverse.bg, fg: c.inverse.text, elevation: null };
    case 'play':
      // White play button on the night gradient (allowed white surface, §2.16 rule 2).
      return {
        size: 76,
        glyph: 40,
        bg: c.text.onGradient,
        fg: c.brand.onSoft,
        elevation: theme.elevation('play'),
      };
    case 'skip15':
      return { size: 52, glyph: 30, bg: undefined, fg: c.text.onGradient, elevation: null };
  }
}

export interface IconButtonProps extends PressableA11yProps {
  readonly icon: IconName;
  /** Required: icon-only controls always carry a label. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly variant?: IconButtonVariant;
  readonly filled?: boolean;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** `skip15` caption under the glyph ("15"); mirrored for forward. */
  readonly caption?: string;
  readonly mirrored?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'surface',
  filled = false,
  disabled = false,
  loading = false,
  caption,
  mirrored = false,
  style,
  testID,
  ...a11y
}: IconButtonProps): JSX.Element {
  const theme = useTheme();
  const l = look(theme, variant);
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.iconButton.${variant}`}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      visualSize={{ width: l.size, height: l.size }}
      style={[
        {
          width: l.size,
          height: l.size,
          borderRadius: l.size / 2,
          backgroundColor: l.bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        l.elevation,
        style,
      ]}
    >
      {loading ? (
        <Spinner
          size={16}
          tone={variant === 'surface' || variant === 'plain' ? 'ink' : 'onGradient'}
        />
      ) : (
        <View style={mirrored ? { transform: [{ scaleX: -1 }] } : null}>
          <Icon name={icon} size={l.glyph} color={l.fg} filled={filled} />
        </View>
      )}
      {caption !== undefined && variant === 'skip15' ? (
        <Text variant="badgeSm" tone="onGradient" style={{ marginTop: -6 }}>
          {caption}
        </Text>
      ) : null}
    </PressableScale>
  );
}

export interface CardIconActionProps extends PressableA11yProps {
  readonly kind: 'complete' | 'more' | 'close' | 'edit' | 'delete';
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  /** Done state: filled green check. */
  readonly done?: boolean;
  readonly disabled?: boolean;
}

const KIND_ICON: Record<CardIconActionProps['kind'], IconName> = {
  complete: 'check_circle',
  more: 'more_horiz',
  close: 'close',
  edit: 'edit',
  delete: 'delete',
};

/** 36×36 transparent card action; glyph 22 `icon.idle`; pressed complete → success soft. */
export function CardIconAction({
  kind,
  accessibilityLabel,
  onPress,
  done = false,
  disabled = false,
  testID,
  ...a11y
}: CardIconActionProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const pressedBg = kind === 'complete' ? c.tone.success.soft : c.surfaceSunken;
  const color = done ? c.tone.success.solid : c.icon.idle;
  return (
    <PressableScale
      {...a11y}
      testID={testID ?? `ui.cardIconAction.${kind}`}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={kind === 'complete' ? { checked: done } : undefined}
      onPress={onPress}
      disabled={disabled}
      visualSize={{ width: 36, height: 36 }}
      pressedStyle={{ backgroundColor: pressedBg }}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      <Icon name={KIND_ICON[kind]} size={22} color={color} filled={done} />
    </PressableScale>
  );
}
