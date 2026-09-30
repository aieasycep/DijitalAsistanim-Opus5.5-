/**
 * `Avatar` (DESIGN_AUDIT §3.13): circle sizes 22 · 28 · 32 · 36 · 38 · 40 · 44 · 56 · 60 · 76 with
 * the initials type per size; the palette is picked by a deterministic hash of the contact id over
 * peach / blue / green / neutral (dark inverts bg and fg); `self` is ink (15/600 at 40); a photo
 * renders as a circle crop. `AvatarPair` overlaps two 44 avatars with a 3 px ring in the parent
 * background.
 */
import type { JSX } from 'react';
import {
  Image,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useUpper } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export const AVATAR_SIZES = [22, 28, 32, 36, 38, 40, 44, 56, 60, 76] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

const INITIAL_SIZE: Record<AvatarSize, number> = {
  22: 10,
  28: 11,
  32: 11,
  36: 12,
  38: 12,
  40: 13,
  44: 15,
  56: 20,
  60: 22,
  76: 26,
};

export const AVATAR_PALETTE = ['peach', 'blue', 'green', 'neutral'] as const;
export type AvatarPaletteName = (typeof AVATAR_PALETTE)[number] | 'self';

/** Deterministic palette entry for an id (FNV-1a over UTF-16 code units). */
export function avatarPalette(id: string): (typeof AVATAR_PALETTE)[number] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length] ?? 'neutral';
}

/** Up to two initials from a display name ("Ahmet Yılmaz" → "AY"). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`;
}

export interface AvatarProps {
  /** The person's name: initials and the accessibility label. */
  readonly name: string;
  /** Stable id for the palette hash (contact id); defaults to the name. */
  readonly id?: string;
  readonly size?: AvatarSize;
  /** The signed-in user (ink). */
  readonly self?: boolean;
  readonly source?: ImageSourcePropType;
  /** Hide from assistive technology when the name is shown next to it. */
  readonly decorative?: boolean;
  /** 3 px ring in the parent background (overlap pairs). */
  readonly ring?: 'bg' | 'surface';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function Avatar({
  name,
  id,
  size = 40,
  self = false,
  source,
  decorative = false,
  ring,
  style,
  testID,
}: AvatarProps): JSX.Element {
  const theme = useTheme();
  const upper = useUpper();
  const palette = self ? theme.color.avatar.self : theme.color.avatar[avatarPalette(id ?? name)];
  const fontSize = self && size === 40 ? 15 : INITIAL_SIZE[size];
  const a11y = decorative
    ? hiddenFromA11y
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: name };
  return (
    <View
      testID={testID ?? 'ui.avatar'}
      {...a11y}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        ring === undefined
          ? null
          : { borderWidth: 3, borderColor: ring === 'bg' ? theme.color.bg : theme.color.surface },
        style,
      ]}
    >
      {source === undefined ? (
        <Text
          variant="labelXs"
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.2), color: palette.fg }}
          maxFontSizeMultiplier={1}
        >
          {upper(initialsOf(name))}
        </Text>
      ) : (
        <Image
          source={source}
          style={{ width: size, height: size }}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

export interface AvatarPairProps {
  readonly first: Omit<AvatarProps, 'size' | 'ring'>;
  readonly second: Omit<AvatarProps, 'size' | 'ring'>;
  /** The background the pair sits on (ring colour). Default: the page background. */
  readonly on?: 'bg' | 'surface';
  readonly style?: StyleProp<ViewStyle>;
}

/** Two overlapping 44 avatars, 3 px ring, margin-left −12. */
export function AvatarPair({ first, second, on = 'bg', style }: AvatarPairProps): JSX.Element {
  return (
    <View style={[{ flexDirection: 'row' }, style]}>
      <Avatar {...first} size={44} ring={on} />
      <Avatar {...second} size={44} ring={on} style={{ marginLeft: -12 }} />
    </View>
  );
}
